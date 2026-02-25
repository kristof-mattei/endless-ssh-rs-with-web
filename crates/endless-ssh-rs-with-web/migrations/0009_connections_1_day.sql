-- no-transaction
-- 1-day continuous aggregate (from 1-hour, kept forever)
CREATE MATERIALIZED VIEW connections_1day
WITH
    (timescaledb.continuous) AS
SELECT
    time_bucket ('1 day', bucket) AS bucket,
    country_code,
    sum(connects)::bigint AS connects,
    sum(time_spent) AS time_spent,
    sum(bytes_sent)::bigint AS bytes_sent
FROM
    connections_1h
GROUP BY
    time_bucket ('1 day', bucket),
    country_code;
