CREATE TABLE
    connections (
        id BIGSERIAL,
        connected_at TIMESTAMPTZ NOT NULL,
        disconnected_at TIMESTAMPTZ NOT NULL,
        time_spent INTERVAL NOT NULL,
        bytes_sent BIGINT NOT NULL,
        ip_address INET NOT NULL,
        country_code CHAR(2),
        country_name TEXT,
        city TEXT,
        latitude DOUBLE PRECISION,
        longitude DOUBLE PRECISION,
        PRIMARY KEY (connected_at, id)
    );

SELECT
    create_hypertable ('connections', 'connected_at');
