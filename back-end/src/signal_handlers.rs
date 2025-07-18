use tokio::signal::unix::{SignalKind, signal};

/// Waits forever for a SIGUSR1
pub async fn wait_for_sigusr1() -> Option<()> {
    signal(SignalKind::user_defined1())
        .expect("Failed to register SIGUSR1 handler")
        .recv()
        .await
}
