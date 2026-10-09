use std::net::{IpAddr, SocketAddr};
use std::sync::Arc;

use arc_swap::ArcSwap;
use axum::extract::ws::{Message, Utf8Bytes};
use serde::Serialize;
use time::{OffsetDateTime, SignedDuration};
use tokio::sync::broadcast;
use tracing::{Level, event};

use crate::db;
use crate::db::types::{AllTimeTotals, ConnectionRecord};
use crate::geoip::{Coordinates, Country, GeoIpReader};
use crate::utils::serde::{Elapsed, Timestamp};

const RECENT_CONNECTIONS: u16 = 100;

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

impl From<ConnectionRecord> for ConnectionEvent {
    fn from(record: ConnectionRecord) -> Self {
        ConnectionEvent::Disconnected {
            sequence: record.id,
            ip: record.ip_address.into(),
            port: record.port.into(),
            connected_at: Timestamp(record.connected_at),
            disconnected_at: Timestamp(record.disconnected_at),
            time_spent: Elapsed(record.time_spent.into()),
            bytes_sent: usize::try_from(record.bytes_sent).unwrap_or(0),
            country: record.country,
            city: record.city,
            coordinates: record.coordinates,
        }
    }
}

pub struct DashboardSnapshot {
    pub totals: AllTimeTotals,
    /// Oldest first.
    pub recent: Vec<ConnectionFrame>,
}

impl DashboardSnapshot {
    pub async fn load(db_pool: &sqlx::PgPool) -> Result<Self, sqlx::Error> {
        let totals = db::get_totals(db_pool).await?;

        let recent = db::get_recent_connections(db_pool, RECENT_CONNECTIONS)
            .await?
            .into_iter()
            .filter_map(|record| {
                ConnectionFrame::new(record.into())
                    .inspect_err(|error| {
                        event!(Level::ERROR, ?error, "Failed to serialize history event");
                    })
                    .ok()
            })
            .collect();

        Ok(Self { totals, recent })
    }

    fn with_stored(&self, totals: AllTimeTotals, frame: ConnectionFrame) -> Self {
        let evicted = (self.recent.len() + 1).saturating_sub(usize::from(RECENT_CONNECTIONS));

        let recent = self
            .recent
            .iter()
            .skip(evicted)
            .cloned()
            .chain(std::iter::once(frame))
            .collect();

        Self { totals, recent }
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
    dashboard_snapshot: Arc<ArcSwap<DashboardSnapshot>>,
    ws_broadcast_tx: broadcast::Sender<ConnectionFrame>,
) {
    while let Some(closed_connection) = closed_connections_rx.recv().await {
        store_closed_connection(
            closed_connection,
            &db_pool,
            &geo_ip_reader,
            &dashboard_snapshot,
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
    dashboard_snapshot: &ArcSwap<DashboardSnapshot>,
    ws_broadcast_tx: &broadcast::Sender<ConnectionFrame>,
) {
    let mut geo = geo_ip_reader.lookup(addr.ip());

    let totals = match db::insert_connection(
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
        Ok(totals) => totals,
        Err(error) => {
            db::log_db_error(&error);

            return;
        },
    };

    let country = geo.as_mut().and_then(|geo| geo.country.take());
    let city = geo.as_mut().and_then(|geo| geo.city.take());

    let connection_event = ConnectionEvent::Disconnected {
        sequence: totals.last_counted_id,
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

    let frame = match ConnectionFrame::new(connection_event) {
        Ok(frame) => frame,
        Err(error) => {
            event!(Level::ERROR, ?error, "Failed to serialize connection event");

            return;
        },
    };

    // sockets subscribe before loading the snapshot, so storing it before the broadcast means no socket misses this frame
    dashboard_snapshot.store(Arc::new(
        dashboard_snapshot.load().with_stored(totals, frame.clone()),
    ));

    let _r = ws_broadcast_tx.send(frame);
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

    use super::{ConnectionEvent, ConnectionFrame, DashboardSnapshot, RECENT_CONNECTIONS};
    use crate::db::types::{AllTimeTotals, DbDuration};
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

    fn bytes_sent_frame(port: u16) -> ConnectionFrame {
        ConnectionFrame::new(ConnectionEvent::BytesSent {
            ip: IP,
            port,
            bytes_sent: 0,
        })
        .unwrap()
    }

    fn totals(last_counted_id: i64) -> AllTimeTotals {
        AllTimeTotals {
            total_connections: last_counted_id,
            total_bytes_sent: 0,
            total_time_spent: DbDuration(SignedDuration::ZERO),
            last_counted_id,
        }
    }

    fn texts(frames: &[ConnectionFrame]) -> Vec<&str> {
        frames.iter().map(|frame| frame.0.as_str()).collect()
    }

    #[test]
    fn stored_frame_is_appended_below_the_cap() {
        let snapshot = DashboardSnapshot {
            totals: totals(1),
            recent: vec![bytes_sent_frame(1)],
        };

        let next = snapshot.with_stored(totals(2), bytes_sent_frame(2));

        assert_eq!(next.totals.last_counted_id, 2);
        assert_eq!(
            texts(&next.recent),
            texts(&[bytes_sent_frame(1), bytes_sent_frame(2)])
        );
    }

    #[test]
    fn stored_frame_evicts_the_oldest_at_the_cap() {
        let snapshot = DashboardSnapshot {
            totals: totals(i64::from(RECENT_CONNECTIONS)),
            recent: (0..RECENT_CONNECTIONS).map(bytes_sent_frame).collect(),
        };

        let next = snapshot.with_stored(
            totals(i64::from(RECENT_CONNECTIONS) + 1),
            bytes_sent_frame(RECENT_CONNECTIONS),
        );

        let expected = (1..=RECENT_CONNECTIONS)
            .map(bytes_sent_frame)
            .collect::<Vec<_>>();

        assert_eq!(texts(&next.recent), texts(&expected));
    }
}
