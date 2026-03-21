use std::net::{Ipv4Addr, Ipv6Addr, SocketAddr, SocketAddrV4, SocketAddrV6};
use std::sync::Arc;

use color_eyre::eyre;
use time::OffsetDateTime;
use tokio::net::TcpListener;
use tokio::sync::{Semaphore, TryAcquireError};
use tokio_util::sync::CancellationToken;
use tokio_util::task::TaskTracker;
use tracing::{Level, event};

use crate::SIZE_IN_BYTES;
use crate::client::{ClientContext, handle_client};
use crate::config::{BindFamily, Config};
use crate::events::ClientEvent;
use crate::ffi_wrapper::set_receive_buffer_size;

struct Listener {
    config: Arc<Config>,
    #[expect(clippy::struct_field_names, reason = "Clarity")]
    tcp_listener: TcpListener,
    client_task_tracker: TaskTracker,
    cancellation_token: CancellationToken,
    internal_events_tx: tokio::sync::mpsc::Sender<ClientEvent>,
    semaphore: Arc<Semaphore>,
}

pub async fn listen_for_new_connections(
    config: Arc<Config>,
    cancellation_token: CancellationToken,
    client_task_tracker: TaskTracker,
    internal_events_tx: tokio::sync::mpsc::Sender<ClientEvent>,
    semaphore: Arc<Semaphore>,
) {
    // listen forever, accept new clients
    let listener = match Listener::bind(
        Arc::clone(&config),
        client_task_tracker,
        cancellation_token.clone(),
        internal_events_tx,
        semaphore,
    )
    .await
    {
        Ok(l) => l,
        Err(error) => {
            event!(Level::ERROR, ?error);

            return;
        },
    };

    event!(Level::INFO, listener = ?listener.tcp_listener, "Bound and listening!");

    loop {
        let result = tokio::select! {
            biased;
            () = cancellation_token.cancelled() => {
                break;
            },
            result = listener.accept() => {
                result
            },
        };

        if let Err(error) = result {
            event!(
                Level::ERROR,
                ?error,
                "Failed to accept new connection, aborting."
            );

            break;
        }
    }
}

impl Listener {
    pub async fn bind(
        config: Arc<Config>,
        client_task_tracker: TaskTracker,
        cancellation_token: CancellationToken,
        internal_events_tx: tokio::sync::mpsc::Sender<ClientEvent>,
        semaphore: Arc<Semaphore>,
    ) -> Result<Self, eyre::Report> {
        let sa = match config.bind_family {
            BindFamily::Ipv4 => {
                SocketAddr::V4(SocketAddrV4::new(Ipv4Addr::UNSPECIFIED, config.port.get()))
            },
            BindFamily::Ipv6 | BindFamily::DualStack => SocketAddr::V6(SocketAddrV6::new(
                Ipv6Addr::UNSPECIFIED,
                config.port.get(),
                0,
                0,
            )),
        };

        // TODO BindFamily::Ipv6 is not respected. Dual stack / IPv6 only are
        // set by /proc/sys/net/ipv6/bindv6only

        let listener = TcpListener::bind(sa).await?;

        Ok(Self {
            config,
            tcp_listener: listener,
            client_task_tracker,
            cancellation_token,
            internal_events_tx,
            semaphore,
        })
    }

    pub async fn accept(&self) -> Result<(), eyre::Report> {
        let accept = self.tcp_listener.accept().await;

        match accept {
            Ok((socket, addr)) => {
                // Set the smallest possible recieve buffer. This reduces local
                // resource usage and slows down the remote end.
                if let Err(error) = set_receive_buffer_size(&socket, SIZE_IN_BYTES) {
                    event!(
                        Level::ERROR,
                        ?error,
                        "Failed to set the tcp stream's receive buffer",
                    );
                } else {
                    // we do try_acquire because either we can add the client or we cannot
                    // no in-between, no sense in waiting
                    match Arc::clone(&self.semaphore).try_acquire_owned() {
                        Ok(permit) => {
                            let connected_at = OffsetDateTime::now_utc();

                            self.client_task_tracker.spawn(handle_client(
                                socket,
                                addr,
                                connected_at,
                                permit,
                                Arc::clone(&self.config),
                                ClientContext {
                                    cancellation_token: self.cancellation_token.clone(),
                                    internal_events_tx: self.internal_events_tx.clone(),
                                },
                            ));

                            // now that the client is registered, broadcast for the dashboard
                            let _r = self
                                .internal_events_tx
                                .send(ClientEvent::Connected { addr, connected_at })
                                .await;

                            let current_clients = usize::from(self.config.max_clients.get())
                                - self.semaphore.available_permits();

                            event!(
                                Level::INFO,
                                addr = ?addr,
                                current_clients,
                                max_clients = self.config.max_clients,
                                "Accepted new client",
                            );
                        },
                        Err(TryAcquireError::NoPermits) => {
                            event!(Level::WARN, ?addr, "Queue full, not accepting new client");
                        },
                        Err(error @ TryAcquireError::Closed) => {
                            return Err(eyre::Report::new(error)
                                .wrap_err("Queue gone, not accepting new client"));
                        },
                    }
                }
            },
            Err(error) => match error.raw_os_error() {
                Some(libc::EMFILE) => {
                    // libc::EMFILE is raised when we've reached our per-process
                    // open handles, so we're setting the limit to the current connected clients
                    // config.max_clients = clients.len().try_into()?;
                    event!(Level::WARN, ?error, "Unable to accept new connection");
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
                    event!(Level::INFO, ?error, "Unable to accept new connection");
                },
                _ => {
                    return Err(
                        eyre::Report::new(error).wrap_err("Unable to accept new connection")
                    );
                },
            },
        }

        Ok(())
    }
}
