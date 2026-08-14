-- Rows are inserted at disconnect but were bucketed and partitioned on connected_at. A long trap therefore inserts into the past, outside every refresh window and possibly past retention, and never rolls up.
-- Bucket on disconnected_at instead and every insert lands at "now". A connection now counts in the bucket where it ended.
-- An aggregate must bucket on the partition column, so the table is rebuilt on disconnected_at and the rows copied over. 0018-0021 rebuild the aggregates.
DROP MATERIALIZED VIEW connections_1day;

DROP MATERIALIZED VIEW connections_1h;

DROP MATERIALIZED VIEW connections_5min;

DROP MATERIALIZED VIEW connections_1min;

CREATE TABLE
    connections_new (
        id BIGSERIAL,
        connected_at TIMESTAMPTZ NOT NULL,
        disconnected_at TIMESTAMPTZ NOT NULL,
        time_spent INTERVAL NOT NULL,
        bytes_sent BIGINT NOT NULL,
        ip_address INET NOT NULL,
        port INTEGER NOT NULL CHECK (port BETWEEN 0 AND 65535),
        country_code CHAR(2),
        country_name TEXT,
        city TEXT,
        latitude DOUBLE PRECISION,
        longitude DOUBLE PRECISION,
        PRIMARY KEY (disconnected_at, id)
    );

SELECT
    create_hypertable ('connections_new', 'disconnected_at');

INSERT INTO
    connections_new (
        id,
        connected_at,
        disconnected_at,
        time_spent,
        bytes_sent,
        ip_address,
        port,
        country_code,
        country_name,
        city,
        latitude,
        longitude
    )
SELECT
    id,
    connected_at,
    disconnected_at,
    time_spent,
    bytes_sent,
    ip_address,
    port,
    country_code,
    country_name,
    city,
    latitude,
    longitude
FROM
    connections;

SELECT
    setval (
        pg_get_serial_sequence ('connections_new', 'id'),
        COALESCE(
            (
                SELECT
                    MAX(id)
                FROM
                    connections
            ),
            0
        ) + 1,
        false
    );

DROP TABLE connections;

ALTER TABLE connections_new
RENAME TO connections;

ALTER SEQUENCE connections_new_id_seq
RENAME TO connections_id_seq;

ALTER INDEX connections_new_pkey
RENAME TO connections_pkey;

ALTER INDEX connections_new_disconnected_at_idx
RENAME TO connections_disconnected_at_idx;
