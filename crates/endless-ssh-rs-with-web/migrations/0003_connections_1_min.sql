-- no-transaction
-- 1-minute continuous aggregate
CREATE MATERIALIZED VIEW connections_1min
WITH
    (timescaledb.continuous) AS
SELECT
    time_bucket ('1 minute', connected_at) AS bucket,
    country_code,
    count(*)::bigint AS connects,
    sum(time_spent) AS time_spent,
    sum(bytes_sent)::bigint AS bytes_sent
FROM
    connections
GROUP BY
    bucket,
    country_code;
