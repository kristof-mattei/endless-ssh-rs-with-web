use std::net::{IpAddr, SocketAddr};
use std::sync::Arc;

use dashmap::DashMap;
use time::{Duration, OffsetDateTime};
use tokio::sync::broadcast;
use tokio_util::sync::CancellationToken;
use tracing::{Level, event};

use crate::db;
use crate::geoip::GeoIpReader;
use crate::utils::serde::as_seconds;

/// Internal event bus.
#[derive(Clone)]
pub enum ClientEvent {
    Connected {
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

/// WebSocket broadcast.
#[derive(Clone, serde::Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum WsEvent {
    Init {
        active_connections: Vec<ActiveConnectionInfo>,
        total_connections: i64,
        total_bytes_sent: i64,
        #[serde(serialize_with = "as_seconds")]
        total_time_spent: Duration,
    },
    Ready,
    Connected {
        ip: IpAddr,
        port: u16,
        #[serde(with = "time::serde::rfc3339")]
        connected_at: OffsetDateTime,
        country_code: Option<String>,
        country_name: Option<String>,
        city: Option<String>,
        latitude: Option<f64>,
        longitude: Option<f64>,
    },
    Disconnected {
        sequence: i64,
        ip: IpAddr,
        port: u16,
        #[serde(with = "time::serde::rfc3339")]
        connected_at: OffsetDateTime,
        #[serde(with = "time::serde::rfc3339")]
        disconnected_at: OffsetDateTime,
        #[serde(serialize_with = "as_seconds")]
        time_spent: Duration,
        bytes_sent: usize,
        country_code: Option<String>,
        country_name: Option<String>,
        city: Option<String>,
        latitude: Option<f64>,
        longitude: Option<f64>,
    },
}

/// In-memory representation of currently connected clients.
/// # Considerations
/// We might merge this with the actual Client.
#[derive(Clone, serde::Serialize)]
pub struct ActiveConnectionInfo {
    pub ip: IpAddr,
    pub port: u16,
    #[serde(with = "time::serde::rfc3339")]
    pub connected_at: OffsetDateTime,
    pub latitude: Option<f64>,
    pub longitude: Option<f64>,
    pub country_code: Option<String>,
}

/// Main event-processing loop.
pub async fn database_listen_forever(
    cancellation_token: CancellationToken,
    db_pool: sqlx::PgPool,
    geo_ip_reader: Arc<GeoIpReader>,
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
                &geo_ip_reader,
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
    geo_ip_reader: &GeoIpReader,
    ws_broadcast_tx: &broadcast::Sender<WsEvent>,
    active_connections: &Arc<DashMap<SocketAddr, ActiveConnectionInfo>>,
) {
    match client_event {
        ClientEvent::Connected { addr, connected_at } => {
            let mut geo = (*geo_ip_reader).lookup(addr.ip());

            let info = ActiveConnectionInfo {
                ip: addr.ip(),
                port: addr.port(),
                connected_at,
                latitude: geo.as_ref().and_then(|g| g.latitude),
                longitude: geo.as_ref().and_then(|g| g.longitude),
                country_code: geo.as_ref().and_then(|g| g.country_code.clone()),
            };

            let country_code = geo.as_mut().and_then(|geo| geo.country_code.take());
            let country_name = geo.as_mut().and_then(|geo| geo.country_name.take());
            let city = geo.as_mut().and_then(|geo| geo.city.take());

            let ws_event = WsEvent::Connected {
                ip: info.ip,
                port: info.port,
                connected_at,
                country_code,
                country_name,
                city,
                latitude: info.latitude,
                longitude: info.longitude,
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

            let mut geo = (*geo_ip_reader).lookup(addr.ip());

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
                    let country_code = geo.as_mut().and_then(|geo| geo.country_code.take());
                    let country_name = geo.as_mut().and_then(|geo| geo.country_name.take());
                    let city = geo.as_mut().and_then(|geo| geo.city.take());

                    let ws_event = WsEvent::Disconnected {
                        sequence,
                        ip: addr.ip(),
                        port: addr.port(),
                        connected_at,
                        disconnected_at,
                        time_spent,
                        bytes_sent,
                        country_code,
                        country_name,
                        city,
                        latitude: geo.as_ref().and_then(|g| g.latitude),
                        longitude: geo.as_ref().and_then(|g| g.longitude),
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
