use axum::extract::{Query, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::get;
use axum::{Json, Router};
use serde::Deserialize;
use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;
use tracing::{Level, event};

use crate::db;
use crate::router::ws_router::ws_handler;
use crate::state::ApplicationState;

pub fn build_api_router(state: ApplicationState) -> Router {
    Router::new()
        .route("/ws", get(ws_handler))
        .route("/stats", get(stats_handler))
        .with_state(state)
}

#[derive(Debug, Deserialize)]
pub struct StatsQueryParams {
    from: Option<String>,
    to: Option<String>,
}

// GET /api/stats?from=<rfc3339>&to=<rfc3339>
async fn stats_handler(
    Query(StatsQueryParams { from, to }): Query<StatsQueryParams>,
    State(state): State<ApplicationState>,
) -> impl IntoResponse {
    let from_to = if from.is_none() && to.is_none() {
        None
    } else {
        let now = OffsetDateTime::now_utc();

        let to = to
            .as_deref()
            .and_then(|s| OffsetDateTime::parse(s, &Rfc3339).ok())
            .unwrap_or(now);

        // if no from provided, or invalid, fall back to 24 hours before `to`
        let from = from
            .as_deref()
            .and_then(|s| OffsetDateTime::parse(s, &Rfc3339).ok())
            .unwrap_or_else(|| to - time::Duration::hours(24));

        Some((from, to))
    };

    // TODO what happens if we swap to & from?
    match db::get_stats(&state.db_pool, from_to).await {
        Ok(rows) => Json(rows).into_response(),
        Err(error) => {
            event!(Level::ERROR, ?error, "Stats query failed");

            (StatusCode::INTERNAL_SERVER_ERROR, "stats query failed").into_response()
        },
    }
}
