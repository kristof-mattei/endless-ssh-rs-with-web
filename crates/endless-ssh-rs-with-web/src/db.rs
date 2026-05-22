mod conversions;
pub mod types;

use std::net::IpAddr;

use futures::stream::Stream;
use sqlx::PgPool;
use sqlx::migrate::MigrateError;
use sqlx::postgres::PgPoolOptions;
use time::{Duration, OffsetDateTime};
use tracing::{Level, event};

use crate::db::types::{AllTimeTotals, ConnectionRecord, DbDuration, DbIpAddr, Limit};
use crate::geoip::GeoInfo;
use crate::utils::ser_helpers::as_secs;

pub async fn create_pool(database_url: &str) -> Result<PgPool, sqlx::Error> {
    PgPoolOptions::new()
        .max_connections(10)
        .connect(database_url)
        .await
}

pub async fn run_migrations(pool: &PgPool) -> Result<(), MigrateError> {
    sqlx::migrate!().run(pool).await
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

    let mut tx = pool.begin().await?;

    let id: i64 = sqlx::query_scalar!(
        r#"
        INSERT INTO connections (
            connected_at
            , disconnected_at
            , time_spent
            , bytes_sent
            , ip_address
            , country_code
            , country_name
            , city
            , latitude
            , longitude
        ) VALUES (
            $1
            , $2
            , $3
            , $4
            , $5
            , $6
            , $7
            , $8
            , $9
            , $10
        ) RETURNING id
        "#,
        connected_at,
        disconnected_at,
        DbDuration(time_spent) as _,
        bytes_sent,
        DbIpAddr(ip_address) as _,
        geo.and_then(|g| g.country_code.clone()),
        geo.and_then(|g| g.country_name.clone()),
        geo.and_then(|g| g.city.clone()),
        geo.and_then(|g| g.latitude),
        geo.and_then(|g| g.longitude)
    )
    .fetch_one(&mut *tx)
    .await?;

    sqlx::query!(
        r#"
        UPDATE totals
        SET
            total_connections = total_connections + 1
            , total_bytes_sent = total_bytes_sent + $1
            , total_time_spent = total_time_spent + $2
        WHERE id = 1
        "#,
        bytes_sent,
        DbDuration(time_spent) as _,
    )
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;

    Ok(id)
}

/// Return up to `limit` of the most recent connection records with id > `since_id`, ordered by ascending id.
pub fn get_connections_since(
    pool: &PgPool,
    since_id: i64,
    limit: Limit,
) -> impl Stream<Item = Result<ConnectionRecord, sqlx::Error>> + Send + '_ {
    sqlx::query_as!(
        ConnectionRecord,
        r#"
        SELECT
            id
            , ip_address as "ip_address: DbIpAddr"
            , connected_at
            , disconnected_at
            , time_spent as "time_spent: DbDuration"
            , bytes_sent
            , country_code
            , country_name
            , city
            , latitude
            , longitude
        FROM (
            SELECT
                id
                , ip_address
                , connected_at
                , disconnected_at
                , time_spent
                , bytes_sent
                , country_code
                , country_name
                , city
                , latitude
                , longitude
            FROM
                connections
            WHERE
                id > $1
            ORDER BY
                id DESC
            LIMIT $2
        ) AS subquery
        ORDER BY
            id ASC
        "#,
        since_id,
        limit as _
    )
    .fetch(pool)
}

pub async fn get_totals(pool: &PgPool) -> Result<AllTimeTotals, sqlx::Error> {
    let row = sqlx::query_as!(
        AllTimeTotals,
        r#"
        SELECT
            total_connections AS "total_connections!: i64"
            , total_bytes_sent AS "total_bytes_sent!: i64"
            , total_time_spent AS "total_time_spent!: DbDuration"
        FROM totals
        WHERE id = 1
        "#
    )
    .fetch_one(pool)
    .await?;

    Ok(row)
}

/// Aggregated stats returned by the `/api/stats` endpoint.
#[derive(Debug, serde::Serialize)]
pub struct StatsRow {
    #[serde(serialize_with = "time::serde::iso8601::serialize")]
    pub bucket: OffsetDateTime,
    pub country_code: Option<String>,
    pub connects: i64,
    #[serde(serialize_with = "as_secs")]
    pub time_spent: Duration,
    pub bytes_sent: i64,
}

struct DbStatsRow {
    bucket: OffsetDateTime,
    country_code: Option<String>,
    connects: i64,
    time_spent: DbDuration,
    bytes_sent: i64,
}

impl From<DbStatsRow> for StatsRow {
    fn from(row: DbStatsRow) -> Self {
        Self {
            bucket: row.bucket,
            country_code: row.country_code,
            connects: row.connects,
            time_spent: row.time_spent.0,
            bytes_sent: row.bytes_sent,
        }
    }
}

async fn get_stats_1min(
    pool: &PgPool,
    from: OffsetDateTime,
    to: OffsetDateTime,
) -> Result<Vec<StatsRow>, sqlx::Error> {
    let rows = sqlx::query_as!(
        DbStatsRow,
        r#"
        SELECT
            bucket AS "bucket!"
            , country_code
            , connects AS "connects!"
            , time_spent AS "time_spent!: DbDuration"
            , bytes_sent AS "bytes_sent!"
        FROM
            connections_1min
        WHERE
            bucket >= $1
            AND bucket < $2
        ORDER BY
            bucket
        "#,
        from,
        to
    )
    .fetch_all(pool)
    .await?;

    Ok(rows.into_iter().map(StatsRow::from).collect())
}

async fn get_stats_5min(
    pool: &PgPool,
    from: OffsetDateTime,
    to: OffsetDateTime,
) -> Result<Vec<StatsRow>, sqlx::Error> {
    let rows = sqlx::query_as!(
        DbStatsRow,
        r#"
        SELECT
            bucket AS "bucket!"
            , country_code
            , connects AS "connects!"
            , time_spent AS "time_spent!: DbDuration"
            , bytes_sent AS "bytes_sent!"
        FROM
            connections_5min
        WHERE
            bucket >= $1
            AND bucket < $2
        ORDER BY
            bucket
        "#,
        from,
        to
    )
    .fetch_all(pool)
    .await?;

    Ok(rows.into_iter().map(StatsRow::from).collect())
}

async fn get_stats_1h(
    pool: &PgPool,
    from: OffsetDateTime,
    to: OffsetDateTime,
) -> Result<Vec<StatsRow>, sqlx::Error> {
    let rows = sqlx::query_as!(
        DbStatsRow,
        r#"
        SELECT
            bucket AS "bucket!"
            , country_code
            , connects AS "connects!"
            , time_spent AS "time_spent!: DbDuration"
            , bytes_sent AS "bytes_sent!"
        FROM
            connections_1h
        WHERE
            bucket >= $1
            AND bucket < $2
        ORDER BY
            bucket
        "#,
        from,
        to
    )
    .fetch_all(pool)
    .await?;

    Ok(rows.into_iter().map(StatsRow::from).collect())
}

async fn get_stats_1day(
    pool: &PgPool,
    from: OffsetDateTime,
    to: OffsetDateTime,
) -> Result<Vec<StatsRow>, sqlx::Error> {
    let rows = sqlx::query_as!(
        DbStatsRow,
        r#"
        SELECT
            bucket AS "bucket!"
            , country_code
            , connects AS "connects!"
            , time_spent AS "time_spent!: DbDuration"
            , bytes_sent AS "bytes_sent!"
        FROM
            connections_1day
        WHERE
            bucket >= $1
            AND bucket < $2
        ORDER BY
            bucket
        "#,
        from,
        to
    )
    .fetch_all(pool)
    .await?;

    Ok(rows.into_iter().map(StatsRow::from).collect())
}

/// Return all 1-day rows when no range is given, otherwise pick the right aggregate tier for the scale of [from, to).
pub async fn get_stats(
    pool: &PgPool,
    from_to: Option<(OffsetDateTime, OffsetDateTime)>,
) -> Result<Vec<StatsRow>, sqlx::Error> {
    if let Some((from, to)) = from_to {
        let span_hours = (to - from).whole_hours();

        if span_hours <= 24 {
            get_stats_1min(pool, from, to).await
        } else if span_hours <= 24 * 7 {
            get_stats_5min(pool, from, to).await
        } else if span_hours <= 24 * 30 {
            get_stats_1h(pool, from, to).await
        } else {
            get_stats_1day(pool, from, to).await
        }
    } else {
        let rows = sqlx::query_as!(
            DbStatsRow,
            r#"
            SELECT
                bucket AS "bucket!"
                , country_code
                , connects AS "connects!"
                , time_spent AS "time_spent!: DbDuration"
                , bytes_sent AS "bytes_sent!"
            FROM
                connections_1day
            ORDER BY
                bucket
            "#
        )
        .fetch_all(pool)
        .await?;

        Ok(rows.into_iter().map(StatsRow::from).collect())
    }
}

#[track_caller]
pub fn log_db_error(error: &sqlx::Error) {
    event!(Level::ERROR, ?error, "Database error");
}
