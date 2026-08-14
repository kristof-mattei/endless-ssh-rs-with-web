-- no-transaction
-- 1-day continuous aggregate (from 1-hour, kept forever), real-time per 0015
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
    country_name;
