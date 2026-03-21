use std::net::SocketAddr;
use std::num::NonZeroU8;

use time::{Duration, OffsetDateTime};
use tokio::sync::OwnedSemaphorePermit;
use tokio::sync::mpsc::Sender;
use tokio::time::sleep;
use tokio_util::sync::CancellationToken;
use tracing::{Level, event};

use crate::events::ClientEvent;
use crate::sender;

pub struct Client<S> {
    time_spent: Duration,
    send_next: OffsetDateTime,
    connected_at: OffsetDateTime,
    bytes_sent: usize,
    addr: SocketAddr,
    tcp_stream: Option<S>,
    permit: Option<OwnedSemaphorePermit>,
    internal_events_tx: Sender<ClientEvent>,
}

impl<S> std::fmt::Debug for Client<S> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Client")
            .field("time_spent", &self.time_spent)
            .field("send_next", &self.send_next)
            .field("bytes_sent", &self.bytes_sent)
            .field("addr", &self.addr)
            // .field("tcp_stream", &self.tcp_stream)
            .finish_non_exhaustive()
    }
}

impl<S> Client<S> {
    pub fn new(
        stream: S,
        addr: SocketAddr,
        connected_at: OffsetDateTime,
        start_sending_at: OffsetDateTime,
        permit: OwnedSemaphorePermit,
        internal_events_tx: Sender<ClientEvent>,
    ) -> Self {
        Self {
            time_spent: Duration::ZERO,
            send_next: start_sending_at,
            connected_at,
            addr,
            bytes_sent: 0,
            tcp_stream: Some(stream),
            permit: Some(permit),
            internal_events_tx,
        }
    }

    #[expect(unused, reason = "Consistency with other props")]
    pub fn time_spent(&self) -> Duration {
        self.time_spent
    }

    pub fn time_spent_mut(&mut self) -> &mut Duration {
        &mut self.time_spent
    }

    pub fn send_next(&self) -> OffsetDateTime {
        self.send_next
    }

    pub fn send_next_mut(&mut self) -> &mut OffsetDateTime {
        &mut self.send_next
    }

    #[expect(unused, reason = "Consistency with other props")]
    pub fn bytes_sent(&self) -> usize {
        self.bytes_sent
    }

    pub fn bytes_sent_mut(&mut self) -> &mut usize {
        &mut self.bytes_sent
    }

    pub fn addr(&self) -> SocketAddr {
        self.addr
    }

    pub fn tcp_stream_mut(&mut self) -> &mut S {
        self.tcp_stream.as_mut().unwrap()
    }

    pub async fn listen_forever(
        mut self,
        cancellation_token: CancellationToken,
        delay: std::time::Duration,
        max_line_length: NonZeroU8,
    ) where
        S: tokio::io::AsyncWriteExt + std::marker::Unpin + std::fmt::Debug,
    {
        loop {
            let now = OffsetDateTime::now_utc();
            let client_send_next = self.send_next();

            if client_send_next > now {
                let until_ready = (client_send_next - now)
                    .try_into()
                    .expect("`send_next` is larger than `now`, so duration should be positive");

                event!(Level::TRACE, addr = ?self.addr(), ?until_ready, "Scheduled client");

                tokio::select! {
                    biased;
                    () = cancellation_token.cancelled() => {
                        return;
                    },
                    () = sleep(until_ready) => {}
                }
            }

            event!(Level::DEBUG, addr = ?self.addr(), "Processing client");

            let stream = self.tcp_stream_mut();

            let send_result = tokio::select! {
                biased;
                () = cancellation_token.cancelled() => {
                    return;
                },
                result = sender::sendline(stream, max_line_length.get().into()) => {
                    result
                },
            };

            if let Ok(bytes_sent) = send_result {
                *self.bytes_sent_mut() += bytes_sent;
                *self.time_spent_mut() += delay;

                *self.send_next_mut() = OffsetDateTime::now_utc() + delay;
            } else {
                event!(Level::TRACE, ?self, "Client gone");

                return;
            }
        }
    }
}

impl<S> Drop for Client<S> {
    /// Destroys `self`, recording stats, and broadcasting the client is gone.
    fn drop(&mut self) {
        event!(
            Level::INFO,
            addr = %self.addr,
            time_spent = %self.time_spent,
            bytes_sent = self.bytes_sent,
            "Dropping client...",
        );

        let disconnected_at = OffsetDateTime::now_utc();

        if let Some(permit) = self.permit.take() {
            let available_slots = permit.semaphore().available_permits();

            drop(permit);

            event!(Level::INFO, available_slots = available_slots + 1);
        } else {
            event!(
                Level::ERROR,
                "Client had no permit, this should never happen."
            );
        }

        if let Some(tcp_stream) = self.tcp_stream.take() {
            drop(tcp_stream);
        } else {
            event!(
                Level::ERROR,
                "Client had tcp stream, this should never happen.."
            );
        }

        let internal_events_tx = self.internal_events_tx.clone();
        let addr = self.addr;
        let connected_at = self.connected_at;
        let time_spent = self.time_spent;
        let bytes_sent = self.bytes_sent;

        tokio::spawn(async move {
            let _result = internal_events_tx
                .send(ClientEvent::Disconnected {
                    addr,
                    connected_at,
                    disconnected_at,
                    time_spent,
                    bytes_sent,
                })
                .await;
        });
    }
}
