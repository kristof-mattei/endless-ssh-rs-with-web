-- Set data retention policies
SELECT
    add_retention_policy ('connections', INTERVAL '24 hours');

SELECT
    add_retention_policy ('connections_1min', INTERVAL '24 hours');

SELECT
    add_retention_policy ('connections_5min', INTERVAL '7 days');

SELECT
    add_retention_policy ('connections_1h', INTERVAL '30 days');

-- connections_1day: no retention (kept forever, for now...)
