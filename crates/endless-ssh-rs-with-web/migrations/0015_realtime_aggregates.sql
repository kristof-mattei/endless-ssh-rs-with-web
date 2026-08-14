-- Continuous aggregates default to materialized_only since TimescaleDB 2.13, so a query stops at the last materialized bucket: connections_1day lags its end_offset plus schedule_interval, 1 to 2 days.
-- Real-time aggregation computes the un-materialized head from the tier below at query time, shrinking the lag to that tier's materialized head (about 2 hours for connections_1day).
ALTER MATERIALIZED VIEW connections_1h
SET
    (timescaledb.materialized_only = FALSE);

ALTER MATERIALIZED VIEW connections_1day
SET
    (timescaledb.materialized_only = FALSE);
