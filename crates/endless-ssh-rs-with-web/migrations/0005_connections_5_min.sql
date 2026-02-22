-- no-transaction
-- 5-minute continuous aggregate (from 1-min)
CREATE MATERIALIZED VIEW connections_5min
WITH
    (timescaledb.continuous) AS
SELECT
    time_bucket ('5 minutes', bucket) AS bucket,
    country_code,
    sum(connects) AS connects,
    sum(time_spent) AS time_spent,
    sum(bytes_sent) AS bytes_sent
FROM
    connections_1min
GROUP BY
    time_bucket ('5 minutes', bucket),
    country_code;
