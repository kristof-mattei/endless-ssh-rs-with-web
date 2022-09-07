use std::sync::atomic::{AtomicBool, Ordering};

use ::time::OffsetDateTime;
use tracing::{event, Level};

use crate::cli::parse_cli;
use crate::client::Client;
use crate::clients::Clients;
use crate::handlers::set_up_handlers;
use crate::listener::Listener;
use crate::statistics::Statistics;

mod cli;
mod client;
mod clients;
mod config;
mod ffi_wrapper;
mod handlers;
mod line;
mod listener;
mod sender;
mod statistics;
mod traits;

static RUNNING: AtomicBool = AtomicBool::new(true);
static DUMPSTATS: AtomicBool = AtomicBool::new(false);

fn main() -> Result<(), anyhow::Error> {
    tracing_subscriber::fmt::init();

    let mut statistics: Statistics = Statistics::new();

    let mut config = parse_cli().map_err(|e| {
        // this prints the error in color and exits
        // can't do anything else until
        // https://github.com/clap-rs/clap/issues/2914
        // is merged in
        if let Some(clap_error) = e.downcast_ref::<clap::error::Error>() {
            clap_error.exit();
        }

        e
    })?;

    config.log();

    // Install the signal handlers
    set_up_handlers()?;

    let mut clients = Clients::new();

    let listener = Listener::start_listening(&config)?;

    while RUNNING.load(Ordering::SeqCst) {
        if DUMPSTATS.load(Ordering::SeqCst) {
            // print stats requested (SIGUSR1)
            statistics.log_totals(&(*clients));
            DUMPSTATS.store(false, Ordering::SeqCst);
        }

        // Enqueue clients that are due for another message
        let queue_processing_result = clients.process_queue(&config);

        statistics.bytes_sent += queue_processing_result.bytes_sent;
        statistics.milliseconds += queue_processing_result.time_spent;

        let timeout = queue_processing_result.wait_until.into();

        if clients.len() < config.max_clients.get() && listener.wait_poll(timeout)? {
            event!(
                Level::DEBUG,
                message = "Trying to accept incoming connection"
            );

            let accept = listener.accept();

            statistics.connects += 1;

            match accept {
                Ok((socket, addr)) => {
                    let send_next = OffsetDateTime::now_utc() + config.delay;
                    match socket.set_nonblocking(true) {
                        Ok(_) => {},
                        Err(e) => {
                            event!(
                                Level::WARN,
                                message = "Failed to set incoming connect to non-blocking mode, discarding",
                                ?e,
                            );

                            // can't do anything anymore
                            continue;
                        },
                    }

                    let client = Client::new(socket, addr, send_next);

                    clients.push_back(client);

                    event!(
                        Level::INFO,
                        message = "Accepted new client",
                        addr = ?addr,
                        current_clients = clients.len(),
                        max_clients = config.max_clients
                    );
                },
                Err(e) => match e.raw_os_error() {
                    Some(libc::EMFILE) => {
                        // libc::EMFILE is raised when we've reached our per-process
                        // open handles, so we're setting the limit to the current connected clients
                        config.max_clients = clients.len().try_into()?;
                        event!(Level::WARN, message = "Unable to accept new connection", ?e);
                    },
                    Some(
                        libc::ENFILE
                        | libc::ECONNABORTED
                        | libc::EINTR
                        | libc::ENOBUFS
                        | libc::ENOMEM
                        | libc::EPROTO,
                    ) => {
                        // libc::ENFILE: whole system has too many open handles
                        // libc::ECONNABORTED: connection aborted while accepting
                        // libc::EINTR: signal came in while handling this syscall,
                        // libc::ENOBUFS: no buffer space
                        // libc::ENOMEM: no memory
                        // libc::EPROTO: protocol error
                        // all are non fatal
                        event!(Level::INFO, message = "Unable to accept new connection", ?e);
                    },
                    _ => {
                        let error =
                            anyhow::Error::new(e).context("Unable to accept new connection");

                        event!(Level::ERROR, ?error);

                        return Err(error);
                    },
                },
            }
        }
    }

    let time_spent = clients.destroy_clients();

    statistics.milliseconds += time_spent;

    statistics.log_totals(&[]);

    Ok(())
}
