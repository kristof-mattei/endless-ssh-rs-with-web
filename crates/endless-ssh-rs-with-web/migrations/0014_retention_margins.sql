-- Retention must exceed the downstream aggregate's start_offset, the margin is what allows re-refreshing after downtime or a stalled job before the source rows are gone.
SELECT
    remove_retention_policy ('connections_1min');

SELECT
    add_retention_policy ('connections_1min', INTERVAL '48 hours');

SELECT
    remove_retention_policy ('connections_1h');

SELECT
    add_retention_policy ('connections_1h', INTERVAL '40 days');
