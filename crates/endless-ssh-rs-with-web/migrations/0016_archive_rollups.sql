-- Save the 1h and 1day rollups before 0017 drops the aggregate chain. 0023 wires them back in.
-- Cut at the current bucket. Older buckets keep their archived data, the rebuilt chain owns the rest.
-- connections_5min is not archived. That gap heals within its 7 day retention.
CREATE TABLE
    connections_1h_archive AS
SELECT
    bucket,
    country_code,
    connects,
    time_spent,
    bytes_sent
FROM
    connections_1h
WHERE
    bucket < time_bucket ('1 hour', now());

CREATE TABLE
    connections_1day_archive AS
SELECT
    bucket,
    country_code,
    connects,
    time_spent,
    bytes_sent
FROM
    connections_1day
WHERE
    bucket < time_bucket ('1 day', now());
