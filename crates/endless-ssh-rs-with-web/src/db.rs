mod conversions;
pub mod types;

use std::cmp::Ordering;
use std::net::IpAddr;

use futures::stream::Stream;
use serde::Serialize;
use sqlx::migrate::MigrateError;
use sqlx::postgres::PgPoolOptions;
use sqlx::{AssertSqlSafe, PgExecutor, PgPool, Row as _};
use time::{OffsetDateTime, SignedDuration};
use tracing::{Level, event};

use crate::db::types::{AllTimeTotals, ConnectionRecord, DbDuration, DbIpAddr, DbPort, Limit};
use crate::geoip::GeoInfo;
use crate::utils::serde::as_seconds;

pub async fn create_pool(database_url: &str) -> Result<PgPool, sqlx::Error> {
    PgPoolOptions::new()
        .max_connections(10)
        .connect(database_url)
        .await
}

pub async fn run_migrations(pool: &PgPool) -> Result<(), MigrateError> {
    sqlx::migrate!().run(pool).await
}

#[expect(clippy::too_many_arguments, reason = "One argument per column")]
pub async fn insert_connection(
    pool: &PgPool,
    ip_address: IpAddr,
    port: u16,
    connected_at: OffsetDateTime,
    disconnected_at: OffsetDateTime,
    time_spent: time::SignedDuration,
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
            , port
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
            , $11
        ) RETURNING id
        "#,
        connected_at,
        disconnected_at,
        DbDuration(time_spent) as _,
        bytes_sent,
        DbIpAddr(ip_address) as _,
        i32::from(port),
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
pub fn get_connections_since<'e, E>(
    executor: E,
    since_id: i64,
    limit: Limit,
) -> impl Stream<Item = Result<ConnectionRecord, sqlx::Error>> + Send + 'e
where
    E: PgExecutor<'e> + 'e,
{
    sqlx::query_as!(
        ConnectionRecord,
        r#"
        SELECT
            id
            , ip_address as "ip_address: DbIpAddr"
            , port as "port: DbPort"
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
                , port
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
    .fetch(executor)
}

pub async fn get_totals<'e, E>(executor: E) -> Result<AllTimeTotals, sqlx::Error>
where
    E: PgExecutor<'e>,
{
    // one statement means one snapshot, making the max id exactly the newest row these totals cover
    let row = sqlx::query_as!(
        AllTimeTotals,
        r#"
        SELECT
            total_connections AS "total_connections!: i64"
            , total_bytes_sent AS "total_bytes_sent!: i64"
            , total_time_spent AS "total_time_spent!: DbDuration"
            , (
                SELECT
                    COALESCE(MAX(id), 0)
                FROM
                    connections
            ) AS "last_counted_id!: i64"
        FROM totals
        WHERE id = 1
        "#
    )
    .fetch_one(executor)
    .await?;

    Ok(row)
}

/// Aggregated stats returned by the `/api/stats` endpoint.
#[derive(Debug, Serialize)]
#[cfg_attr(test, derive(ts_rs::TS), ts(export))]
pub struct StatsRow {
    #[serde(serialize_with = "time::serde::rfc3339::serialize")]
    #[cfg_attr(test, ts(type = "string"))]
    pub bucket: OffsetDateTime,
    pub country_code: Option<String>,
    pub country_name: Option<String>,
    pub connects: i64,
    #[serde(serialize_with = "as_seconds")]
    #[cfg_attr(test, ts(type = "number"))]
    pub time_spent: SignedDuration,
    pub bytes_sent: i64,
}

struct Tier {
    table: &'static str,
    bucket_seconds: u32,
    /// Widest span this tier resolves. `None` means any.
    max_span: Option<SignedDuration>,
    /// `None` means kept forever.
    retention: Option<SignedDuration>,
}

impl Tier {
    /// The finest tier for which `covers` holds. The coarsest tier covers everything.
    fn finest(covers: impl Fn(&Tier) -> bool) -> &'static Tier {
        TIERS.iter().rfold(&TIERS[TIERS.len() - 1], |picked, tier| {
            if covers(tier) { tier } else { picked }
        })
    }
}

impl PartialEq for Tier {
    fn eq(&self, other: &Self) -> bool {
        self.bucket_seconds == other.bucket_seconds
    }
}

impl Eq for Tier {}

impl PartialOrd for Tier {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for Tier {
    fn cmp(&self, other: &Self) -> Ordering {
        self.bucket_seconds.cmp(&other.bucket_seconds)
    }
}

const TIERS: [Tier; 4] = [
    Tier {
        table: "connections_1min",
        bucket_seconds: 60,
        max_span: Some(SignedDuration::hours(24)),
        retention: Some(SignedDuration::hours(48)),
    },
    Tier {
        table: "connections_5min",
        bucket_seconds: 300,
        max_span: Some(SignedDuration::days(7)),
        retention: Some(SignedDuration::days(7)),
    },
    Tier {
        table: "connections_1h",
        bucket_seconds: 3600,
        max_span: Some(SignedDuration::days(30)),
        retention: Some(SignedDuration::days(40)),
    },
    Tier {
        table: "connections_1day",
        bucket_seconds: 86400,
        max_span: None,
        retention: None,
    },
];

/// Stats rows plus the bucket width they were aggregated at.
#[derive(Debug, Serialize)]
#[cfg_attr(test, derive(ts_rs::TS), ts(export))]
pub struct StatsResponse {
    pub bucket_seconds: u32,
    pub rows: Vec<StatsRow>,
}

/// Pick the finest tier whose retention still covers `from`, coarsened by span, and return rows for [from, to).
pub async fn get_stats(
    pool: &PgPool,
    from_to: Option<(OffsetDateTime, OffsetDateTime)>,
) -> Result<StatsResponse, sqlx::Error> {
    let (bucket_seconds, rows) = if let Some((from, to)) = from_to {
        let span = to - from;
        let age = OffsetDateTime::now_utc() - from;

        // coarsen for long spans to keep the row count bounded
        let by_span = Tier::finest(|tier| tier.max_span.is_none_or(|max_span| span <= max_span));

        let by_retention =
            Tier::finest(|tier| tier.retention.is_none_or(|retention| age <= retention));

        let tier = by_span.max(by_retention);

        let sql = format!(
            "
        SELECT
            bucket
            , country_code
            , country_name
            , connects
            , time_spent
            , bytes_sent
        FROM
            {}
        WHERE
            bucket >= $1
            AND bucket < $2
        ORDER BY
            bucket
        ",
            tier.table
        );

        // The dynamically injected table is a limited to 4 tables
        let safe_sql = AssertSqlSafe(sql);

        let rows = sqlx::query(safe_sql)
            .bind(from)
            .bind(to)
            .fetch_all(pool)
            .await?;

        (tier.bucket_seconds, rows)
    } else {
        // the 1day tier grows forever, so past two years of history the open-ended query serves weeks to keep the row count bounded
        let oldest: Option<OffsetDateTime> =
            sqlx::query_scalar("SELECT MIN(bucket) FROM connections_1day")
                .fetch_one(pool)
                .await?;

        let serve_weekly = oldest.is_some_and(|oldest| {
            OffsetDateTime::now_utc() - oldest > SignedDuration::days(2 * 365)
        });

        if serve_weekly {
            let rows = sqlx::query(
                "
        SELECT
            time_bucket ('7 days', bucket) AS bucket
            , country_code
            , country_name
            , sum(connects)::bigint AS connects
            , sum(time_spent) AS time_spent
            , sum(bytes_sent)::bigint AS bytes_sent
        FROM
            connections_1day
        GROUP BY
            time_bucket ('7 days', bucket)
            , country_code
            , country_name
        ORDER BY
            bucket
        ",
            )
            .fetch_all(pool)
            .await?;

            (7 * 86400, rows)
        } else {
            let rows = sqlx::query(
                "
        SELECT
            bucket
            , country_code
            , country_name
            , connects
            , time_spent
            , bytes_sent
        FROM
            connections_1day
        ORDER BY
            bucket
        ",
            )
            .fetch_all(pool)
            .await?;

            let tier = TIERS.last().expect("`TIERS` is non-empty");

            (tier.bucket_seconds, rows)
        }
    };

    let rows = rows
        .into_iter()
        .map(|row| {
            Ok(StatsRow {
                bucket: row.try_get("bucket")?,
                country_code: row.try_get("country_code")?,
                country_name: row.try_get("country_name")?,
                connects: row.try_get("connects")?,
                time_spent: row.try_get::<DbDuration, _>("time_spent")?.into(),
                bytes_sent: row.try_get("bytes_sent")?,
            })
        })
        .collect::<Result<Vec<_>, sqlx::Error>>()?;

    Ok(StatsResponse {
        bucket_seconds,
        rows,
    })
}

#[track_caller]
pub fn log_db_error(error: &sqlx::Error) {
    event!(Level::ERROR, ?error, "Database error");
}
