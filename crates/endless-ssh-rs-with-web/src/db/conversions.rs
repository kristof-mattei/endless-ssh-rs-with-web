use std::net::IpAddr;

use ipnet::{IpNet, Ipv4Net, Ipv6Net};
use sqlx::postgres::types::PgInterval;
use time::Duration;

/// Convert `IpAddr` to `IpNetwork` for `PostgreSQL` INET binding.
/// Inserting an `IpAddr` works equally as well, but then we're not explicit.
pub fn to_inet(ip: IpAddr) -> IpNet {
    match ip {
        IpAddr::V4(v4) => IpNet::V4(Ipv4Net::new(v4, 32).expect("32 is a valid IPv4 prefix")),
        IpAddr::V6(v6) => IpNet::V6(Ipv6Net::new(v6, 128).expect("128 is a valid IPv6 prefix")),
    }
}

pub fn to_interval(duration: Duration) -> PgInterval {
    // let's talk about this conversion for a moment:
    // our duration is always positive (we should encode this into the typesystem though!)
    // now, let's talk about what it means for `whole_microseconds()` to exceed `i64::MAX`:
    // that is 106_751_991 days, or 292_471 years.
    // What are the changes that someone is connected that long considering we'd have at least one
    // * power outage
    // * internet outage
    // * thermonuclear war
    // any, I watched Terminator 2 at least 10 times, and played a lot of Fallout
    // (not to mention I rewatched the show 3 times), so I'm prepared for all possiblities.
    // and in the case I'm wrong, we'll cap the value to `i64::MAX`, which is good enough for now
    let microseconds = duration.whole_microseconds().try_into().unwrap_or(i64::MAX);

    PgInterval {
        months: 0,
        days: 0,
        microseconds,
    }
}

pub fn to_duration(interval: PgInterval) -> time::Duration {
    let total_days = (i64::from(interval.months) * 30) + i64::from(interval.days);

    time::Duration::days(total_days) + time::Duration::microseconds(interval.microseconds)
}
