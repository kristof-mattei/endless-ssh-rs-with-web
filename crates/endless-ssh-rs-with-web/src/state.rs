use std::net::SocketAddr;
use std::sync::Arc;

use axum::extract::{FromRef, FromRequestParts};
use axum::http::request::Parts;
use dashmap::DashMap;
use sqlx::PgPool;
use tokio::sync::broadcast;

use crate::events::{ActiveConnectionInfo, WsEvent};
use crate::geoip::GeoIpReader;
use crate::states::config::Config;

/// This is to be able to do:
/// ```no_run
/// async fn get_handler(State(config): State<Arc<Config>>) -> impl IntoResponse {
///     // ...
/// }
/// ```
///
/// Note that `Arc::<Config>` then is cloned.
impl FromRef<ApplicationState> for Arc<Config> {
    fn from_ref(input: &ApplicationState) -> Self {
        Arc::clone(&input.config)
    }
}

#[derive(Clone)]
pub struct ApplicationState {
    pub config: Arc<Config>,
    pub db_pool: PgPool,
    pub geo_ip: Arc<Option<GeoIpReader>>,
    pub ws_broadcast: broadcast::Sender<WsEvent>,
    pub active_connections: Arc<DashMap<SocketAddr, ActiveConnectionInfo>>,
}

impl ApplicationState {
    pub fn new(
        config: Config,
        db_pool: PgPool,
        geo_ip: Arc<Option<GeoIpReader>>,
        ws_broadcast: broadcast::Sender<WsEvent>,
        active_connections: Arc<DashMap<SocketAddr, ActiveConnectionInfo>>,
    ) -> Self {
        ApplicationState {
            config: Arc::new(config),
            db_pool,
            geo_ip,
            ws_broadcast,
            active_connections,
        }
    }
}

/// This is to be able to do:
/// ```no_run
/// async fn get_handler(state: ApplicationState) -> impl IntoResponse {
///     // ...
/// }
/// ```
///
/// Note that `ApplicationState` then is cloned.
impl<S> FromRequestParts<S> for ApplicationState
where
    Self: FromRef<S>,
    S: Send + Sync,
{
    // TODO State not found error
    type Rejection = ();

    async fn from_request_parts(_parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        Ok(Self::from_ref(state))
    }
}
