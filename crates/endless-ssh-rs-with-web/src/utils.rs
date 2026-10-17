pub mod serde;
pub mod task;

use tokio::task::JoinHandle;

use crate::shutdown::Shutdown;

pub async fn flatten_shutdown_handle(
    handle: JoinHandle<Result<!, Shutdown>>,
) -> Result<!, Shutdown> {
    handle.await?
}
