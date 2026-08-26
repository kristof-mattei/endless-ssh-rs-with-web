use serde::{Serialize, Serializer};
use time::{OffsetDateTime, SignedDuration};

/// Wire timestamp: RFC 3339 over JSON.
#[derive(Clone, Copy, Debug, Serialize)]
#[cfg_attr(test, derive(ts_rs::TS), ts(export))]
pub struct Timestamp(
    #[serde(with = "time::serde::rfc3339")]
    #[cfg_attr(test, ts(type = "string"))]
    pub OffsetDateTime,
);

/// Wire duration: whole seconds over JSON.
#[derive(Clone, Debug)]
#[cfg_attr(test, derive(ts_rs::TS), ts(export))]
pub struct Seconds(#[cfg_attr(test, ts(type = "number"))] pub SignedDuration);

impl Serialize for Seconds {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_i64(self.0.whole_seconds())
    }
}

#[cfg(test)]
mod tests {
    use pretty_assertions::assert_eq;
    use time::{OffsetDateTime, SignedDuration};

    use super::{Seconds, Timestamp};

    #[test]
    fn serializes_as_rfc3339_with_z() {
        let whole_second = Timestamp(OffsetDateTime::from_unix_timestamp(1_767_225_600).unwrap());
        let with_millis = Timestamp(
            OffsetDateTime::from_unix_timestamp_nanos(1_767_225_600_184_000_000).unwrap(),
        );

        assert_eq!(
            serde_json::to_string(&whole_second).unwrap(),
            r#""2026-01-01T00:00:00Z""#
        );
        assert_eq!(
            serde_json::to_string(&with_millis).unwrap(),
            r#""2026-01-01T00:00:00.184Z""#
        );
    }

    #[test]
    fn serializes_whole_seconds() {
        assert_eq!(
            serde_json::to_string(&Seconds(SignedDuration::new(90, 500_000_000))).unwrap(),
            "90"
        );
    }
}
