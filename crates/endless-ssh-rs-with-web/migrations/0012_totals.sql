CREATE TABLE totals (
    id BIGINT PRIMARY KEY,
    total_connections BIGINT NOT NULL DEFAULT 0,
    total_bytes_sent BIGINT NOT NULL DEFAULT 0,
    total_time_spent INTERVAL NOT NULL DEFAULT '0 seconds'
);

INSERT INTO totals (id, total_connections, total_bytes_sent, total_time_spent)
WITH
    last_1day AS (
        SELECT COALESCE(MAX(bucket) + INTERVAL '1 day', '-infinity'::timestamptz) AS boundary
        FROM connections_1day
    ),
    last_1h AS (
        SELECT COALESCE(MAX(bucket) + INTERVAL '1 hour', (SELECT boundary FROM last_1day)) AS boundary
        FROM connections_1h
        WHERE bucket >= (SELECT boundary FROM last_1day)
    ),
    last_5min AS (
        SELECT COALESCE(MAX(bucket) + INTERVAL '5 minutes', (SELECT boundary FROM last_1h)) AS boundary
        FROM connections_5min
        WHERE bucket >= (SELECT boundary FROM last_1h)
    ),
    combined AS (
        SELECT
            SUM(connects)::bigint AS total_connections
            , SUM(bytes_sent)::bigint AS total_bytes_sent
            , SUM(time_spent) AS total_time_spent
        FROM connections_1day
        UNION ALL
        SELECT
            SUM(connects)::bigint
            , SUM(bytes_sent)::bigint
            , SUM(time_spent)
        FROM connections_1h
        WHERE bucket >= (SELECT boundary FROM last_1day)
        UNION ALL
        SELECT
            SUM(connects)::bigint
            , SUM(bytes_sent)::bigint
            , SUM(time_spent)
        FROM connections_5min
        WHERE bucket >= (SELECT boundary FROM last_1h)
        UNION ALL
        SELECT
            COUNT(*)::bigint
            , COALESCE(SUM(bytes_sent), 0)::bigint
            , COALESCE(SUM(time_spent), '0 seconds'::interval)
        FROM connections
        WHERE connected_at >= (SELECT boundary FROM last_5min)
    )
SELECT
    1
    , COALESCE(SUM(total_connections), 0)::bigint
    , COALESCE(SUM(total_bytes_sent), 0)::bigint
    , COALESCE(SUM(total_time_spent), '0 seconds'::interval)
FROM combined;
