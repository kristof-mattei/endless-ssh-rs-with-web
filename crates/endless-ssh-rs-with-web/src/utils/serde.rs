use std::fmt;

use jiff::SignedDuration;
use serde::{Serialize, Serializer};

/// Wire timestamp, `{"$instant": "<RFC 3339>"}`. The front-end reviver turns the wrapper into a `Temporal.Instant`.
#[derive(Clone, Copy, Debug)]
#[cfg_attr(test, derive(ts_rs::TS), ts(export))]
pub(crate) struct Timestamp(#[cfg_attr(test, ts(type = "Temporal.Instant"))] pub jiff::Timestamp);

impl Serialize for Timestamp {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        #[derive(Serialize)]
        struct Tagged {
            #[serde(rename = "$instant")]
            instant: jiff::Timestamp,
        }

        Tagged { instant: self.0 }.serialize(serializer)
    }
}

/// Wire duration, `{"$duration": "<ISO 8601>"}` in whole seconds. The front-end reviver turns the wrapper into a `Temporal.Duration`.
#[derive(Clone, Debug)]
#[cfg_attr(test, derive(ts_rs::TS), ts(export))]
pub(crate) struct Elapsed(#[cfg_attr(test, ts(type = "Temporal.Duration"))] pub SignedDuration);

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

        let seconds = self.0.as_secs();
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
    use jiff::SignedDuration;
    use pretty_assertions::assert_eq;

    use super::{Elapsed, Timestamp};

    // `front-end/src/lib/wire.test.ts` parses these same literals
    #[test]
    fn serializes_as_tagged_rfc3339_with_z() {
        let whole_second = Timestamp(jiff::Timestamp::from_second(1_767_225_600).unwrap());
        let with_millis =
            Timestamp(jiff::Timestamp::from_nanosecond(1_767_225_600_184_000_000).unwrap());

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
