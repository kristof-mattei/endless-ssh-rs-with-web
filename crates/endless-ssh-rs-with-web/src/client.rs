use std::net::SocketAddr;

use time::{Duration, OffsetDateTime};
use tokio::sync::OwnedSemaphorePermit;
use tracing::{Level, event};

use crate::BROADCAST_CHANNEL;
use crate::events::ClientEvent;

pub struct Client<S> {
    time_spent: Duration,
    send_next: OffsetDateTime,
    connected_at: OffsetDateTime,
    bytes_sent: usize,
    addr: SocketAddr,
    tcp_stream: S,
    permit: OwnedSemaphorePermit,
}

impl<S> std::cmp::Eq for Client<S> {}

impl<S> std::cmp::PartialEq for Client<S> {
    fn eq(&self, other: &Self) -> bool {
        self.addr == other.addr
    }
}

impl<S> std::cmp::Ord for Client<S> {
    fn cmp(&self, other: &Self) -> std::cmp::Ordering {
        // flipped to get the oldest first
        other.send_next.cmp(&self.send_next)
    }
}

impl<S> std::cmp::PartialOrd for Client<S> {
    fn partial_cmp(&self, other: &Self) -> Option<std::cmp::Ordering> {
        Some(self.cmp(other))
    }
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
    ) -> Self {
        Self {
            time_spent: Duration::ZERO,
            send_next: start_sending_at,
            connected_at,
            addr,
            bytes_sent: 0,
            tcp_stream: stream,
            permit,
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
        &mut self.tcp_stream
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

        let _result = BROADCAST_CHANNEL.send(ClientEvent::Disconnected {
            addr: self.addr,
            connected_at: self.connected_at,
            disconnected_at,
            time_spent: self.time_spent,
            bytes_sent: self.bytes_sent,
        });

        // no need to shut down the stream, it happens when it is dropped

        // Technically this client's permit isn't available until AFTER this function has ended,
        // as only then the permit gets dropped.
        let available_slots = self.permit.semaphore().available_permits() + 1;

        event!(Level::INFO, available_slots);
    }
}
