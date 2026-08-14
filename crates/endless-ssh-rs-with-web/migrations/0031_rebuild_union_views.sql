-- History from before the 0021 rebuild lives in the 0016 archives. These views glue archive and live aggregate together.
-- One source per bucket. The archive serves everything up to its newest bucket, the aggregate everything after.
CREATE VIEW
    connections_1h_all AS
SELECT
    bucket,
    country_code,
    country_name,
    connects,
    time_spent,
    bytes_sent
FROM
    connections_1h_archive
UNION ALL
SELECT
    bucket,
    country_code,
    country_name,
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
    country_name,
    connects,
    time_spent,
    bytes_sent
FROM
    connections_1day_archive
UNION ALL
SELECT
    bucket,
    country_code,
    country_name,
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
