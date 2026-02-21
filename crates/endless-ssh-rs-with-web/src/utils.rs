pub mod env;
pub mod task;
pub mod url;

use color_eyre::eyre;
use tokio::task::JoinHandle;

use crate::shutdown::Shutdown;

/// Use this when you have a `JoinHandle<Result<T, E>>`
/// and you want to use it with `tokio::try_join!`
/// when the task completes with an `Result::Err`
/// the `JoinHandle` itself will be `Result::Ok` and thus not
/// trigger the `tokio::try_join!`. This function flattens the 2:
/// `Result::Ok(T)` when both the join-handle AND
/// the result of the inner function are `Result::Ok`, and `Result::Err`
/// when either the join failed, or the inner task failed.
///
/// # Errors
/// * When there is an issue executing the task
/// * When the task itself failed.
#[expect(unused, reason = "Library code")]
pub async fn flatten_handle<T, E>(handle: JoinHandle<Result<T, E>>) -> Result<T, eyre::Report>
where
    eyre::Report: From<E>,
{
    match handle.await {
        Ok(Ok(result)) => Ok(result),
        Ok(Err(error)) => Err(error.into()),
        Err(error) => Err(error.into()),
    }
}

pub async fn flatten_shutdown_handle(handle: JoinHandle<Shutdown>) -> Shutdown {
    match handle.await {
        Ok(shutdown) => shutdown,
        Err(join_error) => Shutdown::UnexpectedError(join_error.into()),
    }
}

/// Utility struct to format the elements using the Display trait instead of the Debug trait.
#[repr(transparent)]
#[expect(unused, reason = "Library code")]
pub struct SliceDisplay<'s, T>(pub &'s [T]);

impl<T: std::fmt::Display> std::fmt::Display for SliceDisplay<'_, T> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let mut iter = self.0.iter();

        let Some(first) = iter.next() else {
            return Ok(());
        };

        write!(f, "[{}", first)?;

        for next in iter {
            write!(f, ", {}", next)?;
        }

        write!(f, "]")?;

        Ok(())
    }
}
