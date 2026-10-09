use std::net::{IpAddr, SocketAddr};
use std::sync::Arc;

use axum::extract::ws::{Message, Utf8Bytes};
use serde::Serialize;
use time::{OffsetDateTime, SignedDuration};
use tokio::sync::broadcast;
use tracing::{Level, event};

use crate::db;
use crate::geoip::{Coordinates, Country, GeoIpReader};
use crate::utils::serde::{Elapsed, Timestamp};

pub struct ClosedConnection {
    pub addr: SocketAddr,
    pub connected_at: OffsetDateTime,
    pub disconnected_at: OffsetDateTime,
    pub time_spent: SignedDuration,
    pub bytes_sent: usize,
}

/// WebSocket message.
#[derive(Serialize)]
#[cfg_attr(test, derive(ts_rs::TS), ts(export))]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum WsEvent {
    Init {
        /// The build this server came from. A bundle from another build reloads to fetch its match.
        build_id: &'static str,
        active_connections: Vec<ActiveConnectionInfo>,
        total_connections: i64,
        total_bytes_sent: i64,
        total_time_spent: Elapsed,
        /// Totals cover exactly the connections with id at or below this.
        last_counted_id: i64,
    },
    Ready,
    Heartbeat,
    #[serde(untagged)]
    Connection(ConnectionEvent),
}

/// WebSocket broadcast.
#[derive(Serialize)]
#[cfg_attr(test, derive(ts_rs::TS), ts(export))]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ConnectionEvent {
    Connected {
        ip: IpAddr,
        port: u16,
        connected_at: Timestamp,
        country: Option<Country>,
        city: Option<String>,
        coordinates: Option<Coordinates>,
    },
    BytesSent {
        ip: IpAddr,
        port: u16,
        bytes_sent: usize,
    },
    Disconnected {
        sequence: i64,
        ip: IpAddr,
        port: u16,
        connected_at: Timestamp,
        disconnected_at: Timestamp,
        time_spent: Elapsed,
        bytes_sent: usize,
        country: Option<Country>,
        city: Option<String>,
        coordinates: Option<Coordinates>,
    },
}

/// A `ConnectionEvent` serialized once for every subscriber.
#[derive(Clone)]
pub struct ConnectionFrame(Utf8Bytes);

impl ConnectionFrame {
    pub fn new(connection_event: ConnectionEvent) -> Result<Self, serde_json::Error> {
        let json = serde_json::to_string(&WsEvent::Connection(connection_event))?;

        Ok(Self(json.into()))
    }
}

impl From<ConnectionFrame> for Message {
    fn from(frame: ConnectionFrame) -> Self {
        Message::Text(frame.0)
    }
}

/// In-memory representation of currently connected clients.
/// # Considerations
/// We might merge this with the actual Client.
#[derive(Clone, Serialize)]
#[cfg_attr(test, derive(ts_rs::TS), ts(export))]
pub struct ActiveConnectionInfo {
    pub ip: IpAddr,
    pub port: u16,
    pub connected_at: Timestamp,
    pub bytes_sent: usize,
    pub coordinates: Option<Coordinates>,
    pub country: Option<Country>,
    pub city: Option<String>,
}

/// Stores closed connections one at a time. Concurrent inserts can commit out of id order, and `last_counted_id` assumes every id up to it is committed. Ends when the last sender is dropped, so the disconnects of clients stopped by a shutdown are still stored.
pub async fn database_listen_forever(
    db_pool: sqlx::PgPool,
    geo_ip_reader: Arc<GeoIpReader>,
    mut closed_connections_rx: tokio::sync::mpsc::Receiver<ClosedConnection>,
    ws_broadcast_tx: broadcast::Sender<ConnectionFrame>,
) {
    while let Some(closed_connection) = closed_connections_rx.recv().await {
        store_closed_connection(
            closed_connection,
            &db_pool,
            &geo_ip_reader,
            &ws_broadcast_tx,
        )
        .await;
    }
}

async fn store_closed_connection(
    ClosedConnection {
        addr,
        connected_at,
        disconnected_at,
        time_spent,
        bytes_sent,
    }: ClosedConnection,
    db_pool: &sqlx::PgPool,
    geo_ip_reader: &GeoIpReader,
    ws_broadcast_tx: &broadcast::Sender<ConnectionFrame>,
) {
    let mut geo = geo_ip_reader.lookup(addr.ip());

    match db::insert_connection(
        db_pool,
        addr.ip(),
        addr.port(),
        connected_at,
        disconnected_at,
        time_spent,
        bytes_sent,
        geo.as_ref(),
    )
    .await
    {
        Ok(sequence) => {
            let country = geo.as_mut().and_then(|geo| geo.country.take());
            let city = geo.as_mut().and_then(|geo| geo.city.take());

            let connection_event = ConnectionEvent::Disconnected {
                sequence,
                ip: addr.ip(),
                port: addr.port(),
                connected_at: Timestamp(connected_at),
                disconnected_at: Timestamp(disconnected_at),
                time_spent: Elapsed(time_spent),
                bytes_sent,
                country,
                city,
                coordinates: geo.as_ref().and_then(|g| g.coordinates),
            };

            broadcast_connection_event(ws_broadcast_tx, connection_event);
        },
        Err(error) => {
            db::log_db_error(&error);
        },
    }
}

pub fn broadcast_connection_event(
    ws_broadcast_tx: &broadcast::Sender<ConnectionFrame>,
    connection_event: ConnectionEvent,
) {
    if ws_broadcast_tx.receiver_count() == 0 {
        return;
    }

    match ConnectionFrame::new(connection_event) {
        Ok(frame) => {
            // the last receiver can drop between the count and the send
            let _r = ws_broadcast_tx.send(frame);
        },
        Err(error) => {
            event!(Level::ERROR, ?error, "Failed to serialize connection event");
        },
    }
}

#[cfg(test)]
mod tests {
    use std::net::{IpAddr, Ipv4Addr};

    use axum::extract::ws::Utf8Bytes;
    use pretty_assertions::assert_eq;
    use time::{OffsetDateTime, SignedDuration};

    use super::{ConnectionEvent, ConnectionFrame};
    use crate::geoip::{Coordinates, Country};
    use crate::utils::serde::{Elapsed, Timestamp};

    const IP: IpAddr = IpAddr::V4(Ipv4Addr::new(192, 0, 2, 1));

    fn serialize(connection_event: ConnectionEvent) -> Utf8Bytes {
        ConnectionFrame::new(connection_event).unwrap().0
    }

    #[test]
    fn serializes_connected_as_a_flat_tagged_object() {
        let connected = ConnectionEvent::Connected {
            ip: IP,
            port: 50000,
            connected_at: Timestamp(OffsetDateTime::from_unix_timestamp(1_767_225_600).unwrap()),
            country: Some(Country {
                code: String::from("NL"),
                name: String::from("Netherlands"),
            }),
            city: Some(String::from("Amsterdam")),
            coordinates: Some(Coordinates {
                latitude: 52.37,
                longitude: 4.9,
            }),
        };

        assert_eq!(
            serialize(connected).as_str(),
            r#"{"type":"connected","ip":"192.0.2.1","port":50000,"connected_at":{"$instant":"2026-01-01T00:00:00Z"},"country":{"code":"NL","name":"Netherlands"},"city":"Amsterdam","coordinates":{"latitude":52.37,"longitude":4.9}}"#
        );
    }

    #[test]
    fn serializes_bytes_sent_as_a_flat_tagged_object() {
        let bytes_sent = ConnectionEvent::BytesSent {
            ip: IP,
            port: 50000,
            bytes_sent: 100,
        };

        assert_eq!(
            serialize(bytes_sent).as_str(),
            r#"{"type":"bytes_sent","ip":"192.0.2.1","port":50000,"bytes_sent":100}"#
        );
    }

    #[test]
    fn serializes_disconnected_as_a_flat_tagged_object() {
        let disconnected = ConnectionEvent::Disconnected {
            sequence: 1,
            ip: IP,
            port: 50000,
            connected_at: Timestamp(OffsetDateTime::from_unix_timestamp(1_767_225_600).unwrap()),
            disconnected_at: Timestamp(OffsetDateTime::from_unix_timestamp(1_767_225_690).unwrap()),
            time_spent: Elapsed(SignedDuration::seconds(90)),
            bytes_sent: 100,
            country: None,
            city: None,
            coordinates: None,
        };

        assert_eq!(
            serialize(disconnected).as_str(),
            r#"{"type":"disconnected","sequence":1,"ip":"192.0.2.1","port":50000,"connected_at":{"$instant":"2026-01-01T00:00:00Z"},"disconnected_at":{"$instant":"2026-01-01T00:01:30Z"},"time_spent":{"$duration":"PT90S"},"bytes_sent":100,"country":null,"city":null,"coordinates":null}"#
        );
    }
}
