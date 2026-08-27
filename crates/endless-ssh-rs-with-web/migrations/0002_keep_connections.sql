-- one row per completed connection
CREATE TABLE
    connection_log (
        id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        connected_at TIMESTAMPTZ NOT NULL,
        disconnected_at TIMESTAMPTZ NOT NULL,
        time_spent INTERVAL NOT NULL CHECK (time_spent >= INTERVAL '0'),
        bytes_sent BIGINT NOT NULL CHECK (bytes_sent >= 0),
        ip_address INET NOT NULL,
        port INTEGER NOT NULL CHECK (port BETWEEN 0 AND 65535),
        country_code CHAR(2) CHECK (country_code ~ '^[A-Z]{2}$'),
        country_name TEXT,
        city TEXT,
        latitude DOUBLE PRECISION CHECK (latitude BETWEEN -90 AND 90),
        longitude DOUBLE PRECISION CHECK (longitude BETWEEN -180 AND 180),
        CHECK ((country_code IS NULL) = (country_name IS NULL)),
        CHECK ((latitude IS NULL) = (longitude IS NULL))
    );

CREATE INDEX ON connection_log (ip_address, connected_at);

CREATE INDEX ON connection_log (ip_address, disconnected_at);

-- the rows the hypertable still holds come along
INSERT INTO
    connection_log (
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
    connections
ORDER BY
    id;
