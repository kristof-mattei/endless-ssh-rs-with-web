-- The rollups are about to carry country_name (0025-0031). The archives predate that, so they get the column with a best-effort backfill from the names raw still holds. Codes that no longer appear in raw stay NULL and the client falls back to the code.
ALTER TABLE connections_1h_archive
ADD COLUMN country_name TEXT;

ALTER TABLE connections_1day_archive
ADD COLUMN country_name TEXT;

UPDATE connections_1h_archive AS archive
SET
    country_name = latest.country_name
FROM
    (
        SELECT DISTINCT
            ON (country_code) country_code,
            country_name
        FROM
            connections
        WHERE
            country_name IS NOT NULL
        ORDER BY
            country_code,
            disconnected_at DESC
    ) AS latest
WHERE
    latest.country_code = archive.country_code;

UPDATE connections_1day_archive AS archive
SET
    country_name = latest.country_name
FROM
    (
        SELECT DISTINCT
            ON (country_code) country_code,
            country_name
        FROM
            connections
        WHERE
            country_name IS NOT NULL
        ORDER BY
            country_code,
            disconnected_at DESC
    ) AS latest
WHERE
    latest.country_code = archive.country_code;
