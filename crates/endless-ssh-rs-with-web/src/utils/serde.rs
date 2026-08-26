use serde::{Serialize, Serializer};
use time::{OffsetDateTime, SignedDuration};

/// Wire timestamp, `{"$instant": "<RFC 3339>"}`. The front-end reviver turns the wrapper into a `Temporal.Instant`.
#[derive(Clone, Copy, Debug)]
#[cfg_attr(test, derive(ts_rs::TS), ts(export))]
pub struct Timestamp(
    #[cfg_attr(test, ts(type = "import(\"temporal-polyfill\").Temporal.Instant"))]
    pub  OffsetDateTime,
);

impl Serialize for Timestamp {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        #[derive(Serialize)]
        struct Tagged {
            #[serde(
                rename = "$instant",
                serialize_with = "time::serde::rfc3339::serialize"
            )]
            instant: OffsetDateTime,
        }

        Tagged { instant: self.0 }.serialize(serializer)
    }
}

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

    // `front-end/src/lib/wire.test.ts` parses these same literals
    #[test]
    fn serializes_as_tagged_rfc3339_with_z() {
        let whole_second = Timestamp(OffsetDateTime::from_unix_timestamp(1_767_225_600).unwrap());
        let with_millis = Timestamp(
            OffsetDateTime::from_unix_timestamp_nanos(1_767_225_600_184_000_000).unwrap(),
        );

        assert_eq!(
            serde_json::to_string(&whole_second).unwrap(),
            r#"{"$instant":"2026-01-01T00:00:00Z"}"#
        );
        assert_eq!(
            serde_json::to_string(&with_millis).unwrap(),
            r#"{"$instant":"2026-01-01T00:00:00.184Z"}"#
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
