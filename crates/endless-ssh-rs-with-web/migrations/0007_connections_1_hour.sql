-- no-transaction
-- 1-hour continuous aggregate (from 5-min)
CREATE MATERIALIZED VIEW connections_1h
WITH
    (timescaledb.continuous) AS
SELECT
    time_bucket ('1 hour', bucket) AS bucket,
    country_code,
    sum(connects)::bigint AS connects,
    sum(time_spent) AS time_spent,
    sum(bytes_sent)::bigint AS bytes_sent
FROM
    connections_5min
GROUP BY
    time_bucket ('1 hour', bucket),
    country_code;
