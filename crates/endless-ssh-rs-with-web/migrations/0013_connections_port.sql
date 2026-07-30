-- 0 is allowed, a scanner with its own TCP stack can complete a handshake from source port 0
ALTER TABLE connections
ADD COLUMN port INTEGER NOT NULL DEFAULT 0 CHECK (port BETWEEN 0 AND 65535);

-- the default only exists to backfill the rows above, every future insert supplies the port
ALTER TABLE connections
ALTER COLUMN port
DROP DEFAULT;
