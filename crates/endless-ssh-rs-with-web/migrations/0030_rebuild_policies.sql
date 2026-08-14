-- Same policies as before the rebuild. Refresh windows from 0004-0010, retention from 0011 and 0014.
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

SELECT
    add_retention_policy ('connections_1min', INTERVAL '48 hours');

SELECT
    add_retention_policy ('connections_5min', INTERVAL '7 days');

SELECT
    add_retention_policy ('connections_1h', INTERVAL '40 days');
