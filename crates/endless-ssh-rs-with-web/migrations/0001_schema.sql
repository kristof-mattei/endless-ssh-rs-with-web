-- no-transaction
CREATE EXTENSION IF NOT EXISTS timescaledb;

-- A row is a completed connection, inserted at disconnect. Everything times, buckets, and ages by disconnected_at: inserts land at "now", so refresh windows always see them and retention ages rows from insert.
CREATE TABLE
    connections (
        id BIGINT GENERATED ALWAYS AS IDENTITY,
        connected_at TIMESTAMPTZ NOT NULL,
        disconnected_at TIMESTAMPTZ NOT NULL,
        -- measured monotonically by the client, deliberately not derived from the timestamps
        time_spent INTERVAL NOT NULL CHECK (time_spent >= INTERVAL '0'),
        bytes_sent BIGINT NOT NULL CHECK (bytes_sent >= 0),
        ip_address INET NOT NULL,
        -- 0 is allowed, a scanner with its own TCP stack can complete a handshake from source port 0
        port INTEGER NOT NULL CHECK (port BETWEEN 0 AND 65535),
        country_code CHAR(2) CHECK (country_code ~ '^[A-Z]{2}$'),
        country_name TEXT,
        city TEXT,
        latitude DOUBLE PRECISION CHECK (latitude BETWEEN -90 AND 90),
        longitude DOUBLE PRECISION CHECK (longitude BETWEEN -180 AND 180),
        PRIMARY KEY (disconnected_at, id),
        -- a coordinate is a pair
        CHECK ((latitude IS NULL) = (longitude IS NULL))
    );

SELECT
    create_hypertable ('connections', by_range ('disconnected_at', INTERVAL '1 day'));

-- the replay cursor (id > $1) and the totals watermark (MAX(id)) both walk this
CREATE INDEX ON connections (id);

-- All-time counters, maintained in the insert transaction. The rollups cannot recompute these, raw retention is 24 hours.
CREATE TABLE
    totals (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        total_connections BIGINT NOT NULL DEFAULT 0,
        total_bytes_sent BIGINT NOT NULL DEFAULT 0,
        total_time_spent INTERVAL NOT NULL DEFAULT INTERVAL '0'
    );

INSERT INTO
    totals (id)
VALUES
    (1);

-- Rollup chain, finest to coarsest.
-- WITH NO DATA keeps the creation legal inside the migration's transaction, and an empty table has nothing to materialize anyway.
CREATE MATERIALIZED VIEW connections_1min
WITH
    (timescaledb.continuous) AS
SELECT
    time_bucket ('1 minute', disconnected_at) AS bucket,
    country_code,
    country_name,
    count(*)::bigint AS connects,
    sum(time_spent) AS time_spent,
    sum(bytes_sent)::bigint AS bytes_sent
FROM
    connections
GROUP BY
    bucket,
    country_code,
    country_name
WITH
    NO DATA;

CREATE MATERIALIZED VIEW connections_5min
WITH
    (timescaledb.continuous) AS
SELECT
    time_bucket ('5 minutes', bucket) AS bucket,
    country_code,
    country_name,
    sum(connects)::bigint AS connects,
    sum(time_spent) AS time_spent,
    sum(bytes_sent)::bigint AS bytes_sent
FROM
    connections_1min
GROUP BY
    time_bucket ('5 minutes', bucket),
    country_code,
    country_name
WITH
    NO DATA;

-- the two tiers queries read for long ranges serve their un-materialized head in real time
CREATE MATERIALIZED VIEW connections_1h
WITH
    (
        timescaledb.continuous,
        timescaledb.materialized_only = FALSE
    ) AS
SELECT
    time_bucket ('1 hour', bucket) AS bucket,
    country_code,
    country_name,
    sum(connects)::bigint AS connects,
    sum(time_spent) AS time_spent,
    sum(bytes_sent)::bigint AS bytes_sent
FROM
    connections_5min
GROUP BY
    time_bucket ('1 hour', bucket),
    country_code,
    country_name
WITH
    NO DATA;

CREATE MATERIALIZED VIEW connections_1day
WITH
    (
        timescaledb.continuous,
        timescaledb.materialized_only = FALSE
    ) AS
SELECT
    time_bucket ('1 day', bucket) AS bucket,
    country_code,
    country_name,
    sum(connects)::bigint AS connects,
    sum(time_spent) AS time_spent,
    sum(bytes_sent)::bigint AS bytes_sent
FROM
    connections_1h
GROUP BY
    time_bucket ('1 day', bucket),
    country_code,
    country_name
WITH
    NO DATA;

SELECT add_continuous_aggregate_policy('connections_1min',
    start_offset => INTERVAL '2 hours',
    end_offset => INTERVAL '1 minute',
    schedule_interval => INTERVAL '1 minute');

SELECT add_continuous_aggregate_policy('connections_5min',
    start_offset => INTERVAL '1 day',
    end_offset => INTERVAL '5 minutes',
    schedule_interval => INTERVAL '5 minutes');

SELECT add_continuous_aggregate_policy('connections_1h',
    start_offset => INTERVAL '2 days',
    end_offset => INTERVAL '1 hour',
    schedule_interval => INTERVAL '1 hour');

SELECT add_continuous_aggregate_policy('connections_1day',
    start_offset => INTERVAL '30 days',
    end_offset => INTERVAL '1 day',
    schedule_interval => INTERVAL '1 day');

-- retention strictly above the downstream start_offset, the margin is the catch-up window after downtime
SELECT
    add_retention_policy ('connections', INTERVAL '24 hours');

SELECT
    add_retention_policy ('connections_1min', INTERVAL '48 hours');

SELECT
    add_retention_policy ('connections_5min', INTERVAL '7 days');

SELECT
    add_retention_policy ('connections_1h', INTERVAL '40 days');

-- connections_1day: no retention, kept forever
