use std::net::SocketAddr;
use std::os::fd::{AsRawFd, FromRawFd as _, OwnedFd};
use std::sync::Arc;

use time::{Duration, OffsetDateTime};
use tokio::io::unix::{AsyncFd, AsyncFdReadyGuard};
use tokio::net::TcpStream;
use tokio::sync::OwnedSemaphorePermit;
use tokio::sync::mpsc::Sender;
use tokio::time::{Instant, sleep};
use tokio_util::sync::CancellationToken;
use tracing::{Level, event};

use crate::config::Config;
use crate::events::ClientEvent;
use crate::sender;

pub struct ClientContext {
    pub cancellation_token: CancellationToken,
    pub internal_events_tx: Sender<ClientEvent>,
}

/// Creates an epoll fd that monitors `socket_fd` for `EPOLLRDHUP | EPOLLERR | EPOLLHUP`,
/// but NOT `EPOLLIN`. This lets us detect disconnects without spending
/// time reading what the client sends.
fn make_disconnect_epoll(socket_fd: i32) -> Result<OwnedFd, std::io::Error> {
    // SAFETY: syscall
    let epfd = unsafe { libc::epoll_create1(libc::EPOLL_CLOEXEC) };
    if epfd < 0 {
        return Err(std::io::Error::last_os_error());
    }

    // SAFETY: epfd is a valid fd we now own; wrap it immediately so it is closed
    // on any subsequent error path
    let owned_epfd = unsafe { OwnedFd::from_raw_fd(epfd) };

    // SAFETY: epoll_event is a C struct, zero is a valid bit pattern for it
    let mut ev: libc::epoll_event = unsafe { std::mem::zeroed() };
    ev.events = (libc::EPOLLRDHUP | libc::EPOLLERR | libc::EPOLLHUP) as u32;

    // SAFETY: owned_epfd holds a valid epoll fd; socket_fd is a valid fd owned
    // by the caller; ev is fully initialized
    let ret = unsafe {
        libc::epoll_ctl(
            owned_epfd.as_raw_fd(),
            libc::EPOLL_CTL_ADD,
            socket_fd,
            &raw mut ev,
        )
    };
    if ret != 0 {
        return Err(std::io::Error::last_os_error());
    }

    Ok(owned_epfd)
}

async fn await_async_epfd<T>(async_fd: Option<&'_ AsyncFd<T>>) -> AsyncFdReadyGuard<'_, T>
where
    T: AsRawFd,
{
    let Some(fd) = async_fd else {
        return std::future::pending().await;
    };

    match fd.readable().await {
        Ok(guard) => std::future::ready(guard).await,
        Err(error) => {
            event!(Level::TRACE, ?error, "epoll readable failed");

            std::future::pending().await
        },
    }
}

async fn listen_forever(
    mut stream: TcpStream,
    addr: SocketAddr,
    connected_at: OffsetDateTime,
    config: &Config,
    context: &ClientContext,
) -> (Duration, usize) {
    // use monotonic time to measure elapsed time of how long client is connected
    let connected_instant = Instant::now();
    let mut send_next = connected_instant + config.delay;
    let mut time_spent = Duration::ZERO;
    let mut bytes_sent = 0_usize;

    // register the stream for disconnect events only, failures are non-fatal and
    // disable disconnect detection for this client (i.e. falls back to send-based detection)
    let async_epfd: Option<AsyncFd<OwnedFd>> = match make_disconnect_epoll(stream.as_raw_fd())
        .and_then(|epfd| AsyncFd::new(epfd))
    {
        Ok(fd) => Some(fd),
        Err(error) => {
            event!(Level::WARN, %addr, ?error, "epoll setup failed, disconnect detection disabled");

            None
        },
    };

    loop {
        let wait_started_at = Instant::now();

        if wait_started_at < send_next {
            let until_ready = send_next.duration_since(wait_started_at);

            event!(Level::TRACE, %addr, ?until_ready, "Scheduled client");

            let guard = tokio::select! {
                biased;
                () = context.cancellation_token.cancelled() => {
                    return (time_spent, bytes_sent);
                },
                guard = await_async_epfd::<OwnedFd>(async_epfd.as_ref()) => {
                    Some(guard)
                },
                () = sleep(until_ready) => {
                    None
                }
            };

            if let Some(mut guard) = guard {
                // SAFETY: all zeroes are valid for epoll_event
                let mut ev: libc::epoll_event = unsafe { std::mem::zeroed() };

                // SAFETY: async_epfd holds a valid epoll fd, ev is a valid output buffer
                let n = unsafe {
                    // only one event
                    const EVENTS: i32 = 1;

                    // don't block, the fd is ready based on this future firing
                    const TIMEOUT: i32 = 0;

                    libc::epoll_wait(guard.get_ref().as_raw_fd(), &raw mut ev, EVENTS, TIMEOUT)
                };

                guard.clear_ready();

                if n < 0 {
                    let error = std::io::Error::last_os_error();

                    if error.raw_os_error() == Some(libc::EINTR) {
                        event!(Level::TRACE, %addr, "epoll_wait interrupted (EINTR), retrying");
                    } else {
                        event!(Level::WARN, %addr, ?error, "epoll_wait failed, retrying");
                    }

                    continue;
                }

                if n > 0
                    && ev.events & (libc::EPOLLRDHUP | libc::EPOLLERR | libc::EPOLLHUP) as u32 != 0
                {
                    let partial = wait_started_at.elapsed();

                    time_spent += partial;

                    event!(Level::TRACE, %addr, %connected_at, %time_spent, bytes_sent, send_next = %(connected_at + time_spent + config.delay), "Client gone");

                    return (time_spent, bytes_sent);
                }

                // if n == 0 (no events yet) or n > 0 with no matching flags
                // means spurious wakeup, so we just retry
                continue;
            }
        }

        event!(Level::DEBUG, %addr, "Processing client");

        let send_result = tokio::select! {
            biased;
            () = context.cancellation_token.cancelled() => {
                return (time_spent, bytes_sent);
            },
            result = sender::sendline(&mut stream, config.max_line_length.get().into()) => {
                result
            },
        };

        if let Ok(sent) = send_result {
            time_spent += config.delay;
            bytes_sent += sent;

            send_next = Instant::now() + config.delay;
        } else {
            // Send failed, ergo client is gone. If epoll was active it would have
            // fired during the wait had the client disconnected then, so we
            // can credit the full delay. Without epoll we have no proof the
            // client was alive through the wait, so we don't count it.
            if async_epfd.is_some() {
                time_spent += config.delay;
            }

            event!(Level::TRACE, %addr, %time_spent, bytes_sent, "Client gone");

            return (time_spent, bytes_sent);
        }
    }
}

pub async fn handle_client(
    stream: TcpStream,
    addr: SocketAddr,
    connected_at: OffsetDateTime,
    permit: OwnedSemaphorePermit,
    config: Arc<Config>,
    context: ClientContext,
) {
    let (time_spent, bytes_sent) =
        listen_forever(stream, addr, connected_at, &config, &context).await;

    event!(
        Level::INFO,
        %addr,
        %time_spent,
        bytes_sent,
        "Dropping client...",
    );

    let disconnected_at = OffsetDateTime::now_utc();

    let available_slots = permit.semaphore().available_permits();

    drop(permit);

    event!(Level::INFO, available_slots = available_slots + 1);

    let internal_events_tx = context.internal_events_tx.clone();

    tokio::spawn(async move {
        if let Err(error) = internal_events_tx
            .send(ClientEvent::Disconnected {
                addr,
                connected_at,
                disconnected_at,
                time_spent,
                bytes_sent,
            })
            .await
        {
            event!(
                Level::WARN,
                ?error,
                "Failed to send internal client disconnected event"
            );
        }
    });
}
