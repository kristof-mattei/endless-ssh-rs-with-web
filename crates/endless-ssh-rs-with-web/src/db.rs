use std::net::IpAddr;

use ipnet::{IpNet, Ipv4Net, Ipv6Net};
use sqlx::migrate::MigrateError;
use sqlx::postgres::types::PgInterval;
use sqlx::postgres::{PgPoolOptions, PgRow};
use sqlx::prelude::FromRow;
use sqlx::{PgPool, Row as _};
use time::{Duration, OffsetDateTime};
use tracing::{Level, event};

use crate::geoip::GeoInfo;
use crate::utils::ser_helpers::as_secs;

/// Raw connection record.
#[derive(Debug, Clone)]
pub struct ConnectionRecord {
    pub id: i64,
    pub ip_address: IpAddr,
    pub connected_at: OffsetDateTime,
    pub disconnected_at: OffsetDateTime,
    pub time_spent: Duration,
    pub bytes_sent: i64,
    // TODO narrow to 2 characters maybe?
    pub country_code: Option<String>,
    pub country_name: Option<String>,
    pub city: Option<String>,
    pub latitude: Option<f64>,
    pub longitude: Option<f64>,
}

impl FromRow<'_, PgRow> for ConnectionRecord {
    fn from_row(row: &PgRow) -> Result<Self, sqlx::Error> {
        let ip_net: IpNet = row.try_get("ip_address")?;

        let interval: PgInterval = row.try_get("time_spent")?;
        let time_spent = to_duration(interval);

        Ok(ConnectionRecord {
            id: row.try_get("id")?,
            ip_address: ip_net.addr(),
            connected_at: row.try_get("connected_at")?,
            disconnected_at: row.try_get("disconnected_at")?,
            time_spent,
            bytes_sent: row.try_get("bytes_sent")?,
            country_code: row.try_get("country_code")?,
            country_name: row.try_get("country_name")?,
            city: row.try_get("city")?,
            latitude: row.try_get("latitude")?,
            longitude: row.try_get("longitude")?,
        })
    }
}

pub async fn create_pool(database_url: &str) -> Result<PgPool, sqlx::Error> {
    PgPoolOptions::new()
        .max_connections(10)
        .connect(database_url)
        .await
}

pub async fn run_migrations(pool: &PgPool) -> Result<(), MigrateError> {
    sqlx::migrate!().run(pool).await
}

/// Convert `IpAddr` to `IpNetwork` for `PostgreSQL` INET binding.
/// Inserting an `IpAddr` works equally as well, but then we're not explicit.
fn to_inet(ip: IpAddr) -> IpNet {
    let ip = match ip {
        ip @ IpAddr::V4(_) => ip,
        ip @ IpAddr::V6(ipv6_addr) => ipv6_addr.to_ipv4_mapped().map_or(ip, IpAddr::V4),
    };

    match ip {
        IpAddr::V4(v4) => IpNet::V4(Ipv4Net::new(v4, 32).expect("32 is a valid IPv4 prefix")),
        IpAddr::V6(v6) => IpNet::V6(Ipv6Net::new(v6, 128).expect("128 is a valid IPv6 prefix")),
    }
}

fn to_interval(duration: Duration) -> PgInterval {
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

fn to_duration(interval: PgInterval) -> time::Duration {
    let total_days = (i64::from(interval.months) * 30) + i64::from(interval.days);

    time::Duration::days(total_days) + time::Duration::microseconds(interval.microseconds)
}

pub async fn insert_connection(
    pool: &PgPool,
    ip_address: IpAddr,
    connected_at: OffsetDateTime,
    disconnected_at: OffsetDateTime,
    time_spent: time::Duration,
    bytes_sent: usize,
    geo: Option<&GeoInfo>,
) -> Result<i64, sqlx::Error> {
    let bytes_sent = i64::try_from(bytes_sent)
        .inspect_err(|_| {
            event!(
                Level::TRACE,
                %ip_address,
                bytes_sent,
                "Sent more bytes than what we can represent as `i64`, capping to `i64::MAX`"
            );
        })
        .unwrap_or(i64::MAX);

    let id: i64 = sqlx::query_scalar!(
        "
        INSERT INTO connections (
            connected_at, disconnected_at, time_spent, bytes_sent,
            ip_address, country_code, country_name, city, latitude, longitude
        ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10
        ) RETURNING id
        ",
        connected_at,
        disconnected_at,
        to_interval(time_spent),
        bytes_sent,
        to_inet(ip_address),
        geo.and_then(|g| g.country_code.clone()),
        geo.and_then(|g| g.country_name.clone()),
        geo.and_then(|g| g.city.clone()),
        geo.and_then(|g| g.latitude),
        geo.and_then(|g| g.longitude)
    )
    .fetch_one(pool)
    .await?;

    Ok(id)
}

/// Return up to `limit` connection records with id > `since_id`, ordered by id.
pub async fn get_connections_since(
    pool: &PgPool,
    since_id: i64,
    limit: i64,
) -> Result<Vec<ConnectionRecord>, sqlx::Error> {
    // TODO figure out a way to do this with the macro, which makes this compile-time checked
    let rows: Vec<ConnectionRecord> = sqlx::query_as(
        "
        SELECT id, ip_address, connected_at, disconnected_at,
               time_spent, bytes_sent,
               country_code, country_name, city, latitude, longitude
        FROM connections
        WHERE id > $1
        ORDER BY id
        LIMIT $2
        ",
    )
    .bind(since_id)
    .bind(limit)
    .fetch_all(pool)
    .await?;

    Ok(rows)
}

/// Aggregated stats returned by the `/api/stats` endpoint.
#[derive(Debug, serde::Serialize)]
pub struct StatsRow {
    pub bucket: OffsetDateTime,
    pub country_code: Option<String>,
    pub connects: i64,
    #[serde(serialize_with = "as_secs")]
    pub time_spent: Duration,
    pub bytes_sent: i64,
}

/// Pick the right aggregate tier and return rows for [from, to].
pub async fn get_stats(
    pool: &PgPool,
    from_to: Option<(OffsetDateTime, OffsetDateTime)>,
) -> Result<Vec<StatsRow>, sqlx::Error> {
    let rows = if let Some((from, to)) = from_to {
        let span = to - from;
        let span_hours = span.whole_hours();

        let table = if span_hours <= 24 {
            "connections_1min"
        } else if span_hours <= 24 * 7 {
            "connections_5min"
        } else if span_hours <= 24 * 30 {
            "connections_1h"
        } else {
            "connections_1day"
        };

        let sql = format!(
            "
        SELECT bucket, country_code,
               connects, time_spent, bytes_sent
        FROM {table}
        WHERE bucket >= $1 AND bucket < $2
        ORDER BY bucket
        "
        );

        sqlx::query(&sql)
            .bind(from)
            .bind(to)
            .fetch_all(pool)
            .await?
    } else {
        sqlx::query(
            "
        SELECT bucket, country_code,
               connects, time_spent, bytes_sent
        FROM connections_1day
        ORDER BY bucket
        ",
        )
        .fetch_all(pool)
        .await?
    };

    rows.into_iter()
        .map(|row| {
            Ok(StatsRow {
                bucket: row.try_get("bucket")?,
                country_code: row.try_get("country_code")?,
                connects: row.try_get("connects")?,
                time_spent: to_duration(row.try_get("time_spent")?),
                bytes_sent: row.try_get("bytes_sent")?,
            })
        })
        .collect()
}

#[track_caller]
pub fn log_db_error(error: &sqlx::Error) {
    event!(Level::ERROR, ?error, "Database error");
}
