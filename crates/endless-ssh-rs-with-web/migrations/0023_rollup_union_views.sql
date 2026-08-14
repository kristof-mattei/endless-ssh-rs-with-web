-- History from before the rebuild lives in the 0016 archives. These views glue archive and live aggregate together.
-- One source per bucket. The archive serves everything up to its newest bucket, the aggregate everything after.
-- A connection that was still trapped at the cut can count once on each side, in its old bucket in the archive and in its new bucket in the aggregate. That happens once, at migration, for a handful of rows at most.
CREATE VIEW
    connections_1h_all AS
SELECT
    bucket,
    country_code,
    connects,
    time_spent,
    bytes_sent
FROM
    connections_1h_archive
UNION ALL
SELECT
    bucket,
    country_code,
    connects,
    time_spent,
    bytes_sent
FROM
    connections_1h
WHERE
    bucket > (
        SELECT
            COALESCE(MAX(bucket), '-infinity'::timestamptz)
        FROM
            connections_1h_archive
    );

CREATE VIEW
    connections_1day_all AS
SELECT
    bucket,
    country_code,
    connects,
    time_spent,
    bytes_sent
FROM
    connections_1day_archive
UNION ALL
SELECT
    bucket,
    country_code,
    connects,
    time_spent,
    bytes_sent
FROM
    connections_1day
WHERE
    bucket > (
        SELECT
            COALESCE(MAX(bucket), '-infinity'::timestamptz)
        FROM
            connections_1day_archive
    );
