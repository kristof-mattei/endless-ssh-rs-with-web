//! Moves a legacy database (migrations 0001-0023) onto the clean-sheet schema. [`stash`] runs before the migration, [`restore`] after.

use sqlx::PgPool;
use tracing::{Level, event};

use super::MigrationError;

/// The only legacy version this module migrates. An older database has to run the previous release first.
pub(super) const FINAL_LEGACY_VERSION: i64 = 23;

const STASH_SQL: &str = "
CREATE SCHEMA legacy;

-- the legacy rollups predate country_name, resolve it from the raw rows and fall back to the code
CREATE TABLE legacy.country_names AS
SELECT DISTINCT ON (country_code)
    country_code,
    country_name
FROM connections
WHERE country_code IS NOT NULL
    AND country_name IS NOT NULL
ORDER BY country_code, disconnected_at DESC;

CREATE TABLE legacy.connections AS
SELECT
    id,
    connected_at,
    disconnected_at,
    time_spent,
    bytes_sent,
    ip_address,
    port,
    country_code,
    country_name,
    city,
    latitude,
    longitude
FROM connections;

CREATE TABLE legacy.totals AS
SELECT
    total_connections,
    total_bytes_sent,
    total_time_spent
FROM totals
WHERE id = 1;

CREATE TABLE legacy.connections_1min AS
SELECT
    rollup.bucket,
    rollup.country_code,
    COALESCE(names.country_name, rollup.country_code) AS country_name,
    rollup.connects,
    rollup.time_spent,
    rollup.bytes_sent
FROM connections_1min AS rollup
LEFT JOIN legacy.country_names AS names ON names.country_code = rollup.country_code;

CREATE TABLE legacy.connections_5min AS
SELECT
    rollup.bucket,
    rollup.country_code,
    COALESCE(names.country_name, rollup.country_code) AS country_name,
    rollup.connects,
    rollup.time_spent,
    rollup.bytes_sent
FROM connections_5min AS rollup
LEFT JOIN legacy.country_names AS names ON names.country_code = rollup.country_code;

CREATE TABLE legacy.connections_1h AS
SELECT
    rollup.bucket,
    rollup.country_code,
    COALESCE(names.country_name, rollup.country_code) AS country_name,
    rollup.connects,
    rollup.time_spent,
    rollup.bytes_sent
FROM connections_1h_all AS rollup
LEFT JOIN legacy.country_names AS names ON names.country_code = rollup.country_code;

CREATE TABLE legacy.connections_1day AS
SELECT
    rollup.bucket,
    rollup.country_code,
    COALESCE(names.country_name, rollup.country_code) AS country_name,
    rollup.connects,
    rollup.time_spent,
    rollup.bytes_sent
FROM connections_1day_all AS rollup
LEFT JOIN legacy.country_names AS names ON names.country_code = rollup.country_code;

DROP VIEW connections_1h_all;

DROP VIEW connections_1day_all;

DROP MATERIALIZED VIEW connections_1day;

DROP MATERIALIZED VIEW connections_1h;

DROP MATERIALIZED VIEW connections_5min;

DROP MATERIALIZED VIEW connections_1min;

DROP TABLE connections_1h_archive;

DROP TABLE connections_1day_archive;

DROP TABLE connections;

DROP TABLE totals;

DROP TABLE _sqlx_migrations;
";

const RESTORE_SQL: &str = "
DO $$
DECLARE
    max_id BIGINT;
    tier TEXT;
    materialization REGCLASS;
BEGIN
    INSERT INTO connections (
        id,
        connected_at,
        disconnected_at,
        time_spent,
        bytes_sent,
        ip_address,
        port,
        country_code,
        country_name,
        city,
        latitude,
        longitude
    )
    OVERRIDING SYSTEM VALUE
    SELECT
        id,
        connected_at,
        disconnected_at,
        time_spent,
        bytes_sent,
        ip_address,
        port,
        country_code,
        -- the legacy table allowed half a country, the new pair constraint does not
        CASE WHEN country_code IS NOT NULL THEN COALESCE(country_name, country_code) END,
        city,
        -- the legacy table allowed half a coordinate, the new pair constraint does not
        CASE WHEN longitude IS NOT NULL THEN latitude END,
        CASE WHEN latitude IS NOT NULL THEN longitude END
    FROM legacy.connections;

    SELECT MAX(id) INTO max_id FROM connections;

    IF max_id IS NOT NULL THEN
        PERFORM setval(pg_get_serial_sequence('connections', 'id'), max_id);
    END IF;

    UPDATE totals
    SET total_connections = stashed.total_connections,
        total_bytes_sent = stashed.total_bytes_sent,
        total_time_spent = stashed.total_time_spent
    FROM legacy.totals AS stashed
    WHERE totals.id = 1;

    -- a continuous aggregate rejects inserts, its materialization hypertable takes them
    FOREACH tier IN ARRAY ARRAY['connections_1min', 'connections_5min', 'connections_1h', 'connections_1day'] LOOP
        SELECT format('%I.%I', materialization_hypertable_schema, materialization_hypertable_name)
        INTO STRICT materialization
        FROM timescaledb_information.continuous_aggregates
        WHERE view_schema = current_schema()
            AND view_name = tier;

        EXECUTE format(
            'INSERT INTO %s (bucket, country_code, country_name, connects, time_spent, bytes_sent) SELECT bucket, country_code, country_name, connects, time_spent, bytes_sent FROM legacy.%I',
            materialization,
            tier
        );
    END LOOP;

    DROP SCHEMA legacy CASCADE;
END
$$;
";

/// A refresh recomputes its window from the tier below, so a window wider than that tier's coverage would blank restored buckets. Each window here stays inside the tier below it.
///
/// One statement per element: `refresh_continuous_aggregate` cannot run in a transaction block, and a multi-statement batch is one.
const REFRESH_SQL: [&str; 4] = [
    "CALL refresh_continuous_aggregate('connections_1min', now() - INTERVAL '23 hours', now())",
    "CALL refresh_continuous_aggregate('connections_5min', now() - INTERVAL '23 hours', now())",
    "CALL refresh_continuous_aggregate('connections_1h', now() - INTERVAL '2 days', now())",
    "CALL refresh_continuous_aggregate('connections_1day', now() - INTERVAL '3 days', now())",
];

/// Copy a legacy database's data into the `legacy` schema and drop the legacy objects, leaving an empty database for the clean-sheet migration. A database without the legacy history is untouched.
pub async fn stash(pool: &PgPool) -> Result<(), MigrationError> {
    let has_history: bool =
        sqlx::query_scalar("SELECT to_regclass('_sqlx_migrations') IS NOT NULL")
            .fetch_one(pool)
            .await?;

    if !has_history {
        return Ok(());
    }

    // version 1 is 0001_extension.sql in the legacy history and 0001_schema.sql in the clean one
    let is_legacy: bool = sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM _sqlx_migrations WHERE version = 1 AND description = 'extension')",
    )
    .fetch_one(pool)
    .await?;

    if !is_legacy {
        return Ok(());
    }

    let version: Option<i64> = sqlx::query_scalar("SELECT MAX(version) FROM _sqlx_migrations")
        .fetch_one(pool)
        .await?;

    if version != Some(FINAL_LEGACY_VERSION) {
        return Err(MigrationError::UnsupportedLegacyVersion(
            version.unwrap_or(0),
        ));
    }

    event!(Level::INFO, "Legacy schema detected, stashing its data");

    sqlx::raw_sql(STASH_SQL).execute(pool).await?;

    Ok(())
}

/// Restore stashed legacy data into the clean-sheet schema and drop the stash. A database without a stash is untouched.
pub async fn restore(pool: &PgPool) -> Result<(), MigrationError> {
    let has_stash: bool =
        sqlx::query_scalar("SELECT to_regclass('legacy.connections') IS NOT NULL")
            .fetch_one(pool)
            .await?;

    if !has_stash {
        return Ok(());
    }

    event!(Level::INFO, "Restoring stashed legacy data");

    sqlx::raw_sql(RESTORE_SQL).execute(pool).await?;

    // A fresh aggregate's watermark sits at the epoch, and a real-time tier serves nothing from its materialization below that, so the restored history stays invisible until a refresh moves the watermark past it. Finest first, each tier reads the one below.
    for refresh in REFRESH_SQL {
        sqlx::raw_sql(refresh).execute(pool).await?;
    }

    event!(Level::INFO, "Legacy data restored");

    Ok(())
}
