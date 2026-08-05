use serde::Serializer;
use time::SignedDuration;

pub fn as_seconds<S>(duration: &SignedDuration, s: S) -> Result<S::Ok, S::Error>
where
    S: Serializer,
{
    s.serialize_i64(duration.whole_seconds())
}
