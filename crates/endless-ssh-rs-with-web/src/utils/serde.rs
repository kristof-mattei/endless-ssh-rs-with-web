use std::fmt;

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

/// Wire duration, `{"$duration": "<ISO 8601>"}` in whole seconds. The front-end reviver turns the wrapper into a `Temporal.Duration`.
#[derive(Clone, Debug)]
#[cfg_attr(test, derive(ts_rs::TS), ts(export))]
pub struct Elapsed(
    #[cfg_attr(test, ts(type = "import(\"temporal-polyfill\").Temporal.Duration"))]
    pub  SignedDuration,
);

impl Serialize for Elapsed {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        #[derive(Serialize)]
        struct Tagged<'a> {
            #[serde(rename = "$duration")]
            duration: fmt::Arguments<'a>,
        }

        let seconds = self.0.whole_seconds();
        // ISO 8601 signs the whole duration, not the seconds field
        let sign = if seconds < 0 { "-" } else { "" };

        Tagged {
            duration: format_args!("{}PT{}S", sign, seconds.unsigned_abs()),
        }
        .serialize(serializer)
    }
}

#[cfg(test)]
mod tests {
    use pretty_assertions::assert_eq;
    use time::{OffsetDateTime, SignedDuration};

    use super::{Elapsed, Timestamp};

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
    fn serializes_as_tagged_iso8601_whole_seconds() {
        assert_eq!(
            serde_json::to_string(&Elapsed(SignedDuration::new(90, 500_000_000))).unwrap(),
            r#"{"$duration":"PT90S"}"#
        );
        assert_eq!(
            serde_json::to_string(&Elapsed(SignedDuration::ZERO)).unwrap(),
            r#"{"$duration":"PT0S"}"#
        );
    }

    #[test]
    fn serializes_a_negative_duration_with_a_leading_sign() {
        assert_eq!(
            serde_json::to_string(&Elapsed(SignedDuration::new(-90, -500_000_000))).unwrap(),
            r#"{"$duration":"-PT90S"}"#
        );
    }
}
