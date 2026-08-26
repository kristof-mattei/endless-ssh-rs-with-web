use std::path::Path;

use axum::Router;
use axum::body::Body;
use axum::http::{HeaderValue, Response, StatusCode, header};
use tower_http::services::{ServeDir, ServeFile};
use tower_http::set_header::SetResponseHeaderLayer;
use tracing::{Level, event};

pub fn build_html_router() -> Router {
    if let Ok(front_end_proxy) = std::env::var("FRONT_END_PROXY").as_deref() {
        event!(Level::INFO, "Serving website via proxy");

        let vite_proxy_service_builder = tower_proxy::builder_http(front_end_proxy).unwrap();

        let svc: tower_proxy::ReusedService<
            tower_proxy::Identity,
            tower_proxy::client::HttpConnector,
            axum::body::Body,
        > = vite_proxy_service_builder.build(tower_proxy::rewrite::Identity {});

        Router::new().fallback_service(svc)
    } else {
        event!(Level::INFO, "Serving website from dist");

        serve_dist(Path::new("dist"))
    }
}

/// `index.html` names the hashed asset files. Without a cache policy a browser may reuse a cached copy on a fresh
/// navigation and run the previous bundle against the new server, so it is revalidated on every request (a 304 when
/// unchanged). The assets never change under their names and are cached for a year.
fn serve_dist(dist: &Path) -> Router {
    fn immutable(response: &Response<Body>) -> Option<HeaderValue> {
        (response.status() == StatusCode::OK)
            .then(|| HeaderValue::from_static("public, max-age=31536000, immutable"))
    }

    Router::new()
        .nest_service("/assets", ServeDir::new(dist.join("assets")))
        .route_layer(SetResponseHeaderLayer::overriding(
            header::CACHE_CONTROL,
            immutable,
        ))
        .fallback_service(ServeDir::new(dist).fallback(ServeFile::new(dist.join("index.html"))))
        .layer(SetResponseHeaderLayer::if_not_present(
            header::CACHE_CONTROL,
            HeaderValue::from_static("no-cache"),
        ))
}

#[cfg(test)]
mod tests {
    use std::path::{Path, PathBuf};

    use axum::body::Body;
    use axum::http::{Request, Response, StatusCode, header};
    use pretty_assertions::assert_eq;
    use tower::ServiceExt as _;

    use super::serve_dist;

    fn dist() -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("endless-ssh-rs-dist-{}", uuid::Uuid::now_v7()));

        std::fs::create_dir_all(dir.join("assets")).unwrap();
        std::fs::write(dir.join("index.html"), "<html></html>").unwrap();
        std::fs::write(dir.join("favicon.svg"), "<svg/>").unwrap();
        std::fs::write(dir.join("assets").join("index-abc123.js"), "export {};").unwrap();

        dir
    }

    async fn get(dist: &Path, uri: &str) -> Response<Body> {
        serve_dist(dist)
            .oneshot(Request::builder().uri(uri).body(Body::empty()).unwrap())
            .await
            .unwrap()
    }

    fn cache_control(response: &Response<Body>) -> Option<&str> {
        response
            .headers()
            .get(header::CACHE_CONTROL)
            .map(|value| value.to_str().unwrap())
    }

    #[tokio::test]
    async fn hashed_assets_are_immutable() {
        let dist = dist();

        let response = get(&dist, "/assets/index-abc123.js").await;

        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            cache_control(&response),
            Some("public, max-age=31536000, immutable")
        );

        std::fs::remove_dir_all(dist).unwrap();
    }

    #[tokio::test]
    async fn a_missing_asset_is_not_cached_as_immutable() {
        let dist = dist();

        let response = get(&dist, "/assets/index-old.js").await;

        assert_eq!(response.status(), StatusCode::NOT_FOUND);
        assert_eq!(cache_control(&response), Some("no-cache"));

        std::fs::remove_dir_all(dist).unwrap();
    }

    #[tokio::test]
    async fn index_html_is_revalidated_every_time() {
        let dist = dist();

        let response = get(&dist, "/").await;

        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(cache_control(&response), Some("no-cache"));

        std::fs::remove_dir_all(dist).unwrap();
    }

    // `no-cache` keeps the copy and asks before reusing it. The ETag turns that ask into a 304 without a body.
    #[tokio::test]
    async fn an_unchanged_index_html_revalidates_to_304() {
        let dist = dist();

        let first = get(&dist, "/").await;
        let etag = first.headers().get(header::ETAG).unwrap().clone();

        let revalidation = serve_dist(&dist)
            .oneshot(
                Request::builder()
                    .uri("/")
                    .header(header::IF_NONE_MATCH, etag)
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(revalidation.status(), StatusCode::NOT_MODIFIED);

        std::fs::remove_dir_all(dist).unwrap();
    }

    #[tokio::test]
    async fn unknown_paths_fall_back_to_index_html_and_are_revalidated() {
        let dist = dist();

        let response = get(&dist, "/some/client/route").await;

        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(cache_control(&response), Some("no-cache"));

        std::fs::remove_dir_all(dist).unwrap();
    }

    #[tokio::test]
    async fn root_files_are_revalidated() {
        let dist = dist();

        let response = get(&dist, "/favicon.svg").await;

        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(cache_control(&response), Some("no-cache"));

        std::fs::remove_dir_all(dist).unwrap();
    }
}
