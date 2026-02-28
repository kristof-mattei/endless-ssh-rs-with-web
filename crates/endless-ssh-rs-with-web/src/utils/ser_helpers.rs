use serde::Serializer;
use time::Duration;

pub fn as_secs<S>(duration: &Duration, s: S) -> Result<S::Ok, S::Error>
where
    S: Serializer,
{
    s.serialize_i64(duration.whole_seconds())
}
