use std::net::{IpAddr, SocketAddr};
use std::sync::Arc;

use dashmap::DashMap;
use serde::Serializer;
use time::{Duration, OffsetDateTime};
use tokio::sync::broadcast;
use tokio_util::sync::CancellationToken;
use tracing::{Level, event};

use crate::db;
use crate::geoip::GeoIpReader;

/// Internal event bus.
#[derive(Clone)]
pub enum ClientEvent {
    Connected {
        ip: IpAddr,
        addr: SocketAddr,
        connected_at: OffsetDateTime,
    },
    Disconnected {
        addr: SocketAddr,
        connected_at: OffsetDateTime,
        disconnected_at: OffsetDateTime,
        time_spent: Duration,
        bytes_sent: usize,
    },
}

fn secs<S>(duration: &Duration, s: S) -> Result<S::Ok, S::Error>
where
    S: Serializer,
{
    s.serialize_i64(duration.whole_seconds())
}

/// WebSocket broadcast.
#[derive(Clone, serde::Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum WsEvent {
    Init {
        active_connections: Vec<ActiveConnectionInfo>,
    },
    Ready,
    Connected {
        ip: String,
        #[serde(with = "time::serde::rfc3339")]
        connected_at: OffsetDateTime,
        lat: Option<f64>,
        lon: Option<f64>,
    },
    Disconnected {
        seq: i64,
        ip: String,
        #[serde(with = "time::serde::rfc3339")]
        connected_at: OffsetDateTime,
        #[serde(with = "time::serde::rfc3339")]
        disconnected_at: OffsetDateTime,
        #[serde(serialize_with = "secs")]
        time_spent: Duration,
        bytes_sent: usize,
        country_code: Option<String>,
        country_name: Option<String>,
        city: Option<String>,
        lat: Option<f64>,
        lon: Option<f64>,
    },
}

/// In-memory representation of currently connected clients.
/// # Considerations
/// We might merge this with the actual Client.
#[derive(Clone, serde::Serialize)]
pub struct ActiveConnectionInfo {
    pub ip: String,
    #[serde(with = "time::serde::rfc3339")]
    pub connected_at: OffsetDateTime,
    pub lat: Option<f64>,
    pub lon: Option<f64>,
    pub country_code: Option<String>,
}

/// Main event-processing loop.
pub async fn database_listen_forever(
    cancellation_token: CancellationToken,
    db_pool: sqlx::PgPool,
    geo_ip: Arc<Option<GeoIpReader>>,
    mut internal_events_rx: tokio::sync::mpsc::Receiver<ClientEvent>,
    ws_broadcast_tx: broadcast::Sender<WsEvent>,
    active_connections: Arc<DashMap<SocketAddr, ActiveConnectionInfo>>,
) {
    loop {
        let result = tokio::select! {
            biased;
            () = cancellation_token.cancelled() => {
                break;
            },
            result = internal_events_rx.recv() => {
                result
            }
        };

        if let Some(client_event) = result {
            // TODO defer to separate handler loop so we don't hold up our side
            handle_event(
                client_event,
                &db_pool,
                &geo_ip,
                &ws_broadcast_tx,
                &active_connections,
            )
            .await;
        } else {
            event!(Level::ERROR, "Internal event channel closed, aborting");
            break;
        }
    }
}

async fn handle_event(
    client_event: ClientEvent,
    db_pool: &sqlx::PgPool,
    geoip: &Arc<Option<GeoIpReader>>,
    ws_broadcast_tx: &broadcast::Sender<WsEvent>,
    active_connections: &Arc<DashMap<SocketAddr, ActiveConnectionInfo>>,
) {
    match client_event {
        ClientEvent::Connected {
            ip,
            addr,
            connected_at,
        } => {
            let geo = (**geoip).as_ref().and_then(|reader| reader.lookup(ip));

            let info = ActiveConnectionInfo {
                ip: ip.to_string(),
                connected_at,
                lat: geo.as_ref().and_then(|g| g.latitude),
                lon: geo.as_ref().and_then(|g| g.longitude),
                country_code: geo.and_then(|g| g.country_code),
            };

            let ws_event = WsEvent::Connected {
                ip: info.ip.clone(),
                connected_at,
                lat: info.lat,
                lon: info.lon,
            };

            active_connections.insert(addr, info);

            // ignore send errors, no WS clients connected is fine
            let _r = ws_broadcast_tx.send(ws_event);
        },

        ClientEvent::Disconnected {
            addr,
            connected_at,
            disconnected_at,
            time_spent,
            bytes_sent,
        } => {
            active_connections.remove(&addr);

            let mut geo = (**geoip)
                .as_ref()
                .and_then(|reader| reader.lookup(addr.ip()));

            match db::insert_connection(
                db_pool,
                addr.ip(),
                connected_at,
                disconnected_at,
                time_spent,
                bytes_sent,
                geo.as_ref(),
            )
            .await
            {
                Ok(seq) => {
                    let country_code = geo.as_mut().and_then(|geo| geo.country_code.take());
                    let country_name = geo.as_mut().and_then(|geo| geo.country_name.take());
                    let city = geo.as_mut().and_then(|geo| geo.city.take());

                    let ws_event = WsEvent::Disconnected {
                        seq,
                        ip: addr.ip().to_string(),
                        connected_at,
                        disconnected_at,
                        time_spent,
                        bytes_sent,
                        country_code,
                        country_name,
                        city,
                        lat: geo.as_ref().and_then(|g| g.latitude),
                        lon: geo.as_ref().and_then(|g| g.longitude),
                    };

                    // ignore send errors, no WS clients connected yet is fine
                    let _r = ws_broadcast_tx.send(ws_event);
                },
                Err(error) => {
                    db::log_db_error(&error);
                },
            }
        },
    }
}
