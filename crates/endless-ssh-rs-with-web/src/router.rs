mod api_router;
mod html_router;
mod ws_router;

use axum::Router;
use axum::handler::HandlerWithoutStateExt as _;
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::get;
use tower_http::cors::CorsLayer;
use tower_http::on_early_drop::{EarlyDropsAsFailures, OnEarlyDropLayer};
use tower_http::trace::{DefaultOnFailure, DefaultOnRequest, DefaultOnResponse, TraceLayer};
use tracing::Level;

use crate::router::api_router::build_api_router;
pub(crate) use crate::router::html_router::FrontEnd;
use crate::span::MakeSpanWithUuid;
use crate::state::ApplicationState;

async fn handler_404() -> impl IntoResponse {
    (StatusCode::NOT_FOUND, "nothing to see here")
}

async fn healthz() -> impl IntoResponse {
    (StatusCode::OK, "Hello, world!")
}

pub(crate) fn build_router(state: ApplicationState, front_end: &FrontEnd) -> Router {
    let api_router = build_api_router(state);
    let html_router = front_end.router();

    // we can move the `/healthz` layer beneath the `TraceLayer` to prevent it from being logged

    html_router
        .nest(
            "/api",
            api_router.fallback_service(handler_404.into_service()),
        )
        .route("/healthz", get(healthz))
        .layer(CorsLayer::permissive())
        // inside the `TraceLayer` so the drop event lands in the request span
        .layer(OnEarlyDropLayer::new(EarlyDropsAsFailures::new(
            DefaultOnFailure::new().level(Level::DEBUG),
        )))
        .layer(
            TraceLayer::new_for_http()
                .make_span_with(MakeSpanWithUuid::new().level(Level::INFO))
                .on_request(DefaultOnRequest::new().level(Level::TRACE))
                .on_response(DefaultOnResponse::new().level(Level::INFO)),
        )
}
