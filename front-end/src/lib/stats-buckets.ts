import { Temporal } from "temporal-polyfill";

import type { StatsRow } from "../generated/StatsRow";

export interface BucketPointValues {
    bytes_sent: number;
    connects: number;
    time_spent: number;
}

export type BucketPoint = {
    bucket: Temporal.Instant;
} & BucketPointValues;

export interface CountryTotals {
    country_code: null | string;
    connects: number;
    bytes_sent: number;
    time_spent: number;
}

export function topCountries(rows: StatsRow[], limit: number): CountryTotals[] {
    const map = new Map<null | string, CountryTotals>();

    for (const row of rows) {
        const existing = map.get(row.country_code);

        if (existing === undefined) {
            map.set(row.country_code, {
                country_code: row.country_code,
                connects: row.connects,
                bytes_sent: row.bytes_sent,
                time_spent: row.time_spent,
            });
        } else {
            existing.connects += row.connects;
            existing.bytes_sent += row.bytes_sent;
            existing.time_spent += row.time_spent;
        }
    }

    return map
        .values()
        .toArray()
        .sort((a, b) => {
            return b.connects - a.connects;
        })
        .slice(0, limit);
}

export function aggregate(
    rows: StatsRow[],
    from: Temporal.Instant,
    to: Temporal.Instant,
    intervalMs: number,
): BucketPoint[] {
    const map = new Map<number, BucketPoint>();

    for (const row of rows) {
        const bucket = Temporal.Instant.from(row.bucket);
        const key = bucket.epochMilliseconds;
        const existing = map.get(key);

        if (existing === undefined) {
            map.set(key, {
                bucket,
                bytes_sent: row.bytes_sent,
                connects: row.connects,
                time_spent: row.time_spent,
            });
        } else {
            existing.bytes_sent += row.bytes_sent;
            existing.connects += row.connects;
            existing.time_spent += row.time_spent;
        }
    }

    // Fill in zero-value entries for every bucket in [from, to) that has no data.
    // TimescaleDB aligns buckets to the Unix epoch, so rounding to intervalMs works.
    const startMs = Math.ceil(from.epochMilliseconds / intervalMs) * intervalMs;

    for (let ms = startMs; ms < to.epochMilliseconds; ms += intervalMs) {
        if (!map.has(ms)) {
            map.set(ms, {
                bucket: Temporal.Instant.fromEpochMilliseconds(ms),
                bytes_sent: 0,
                connects: 0,
                time_spent: 0,
            });
        }
    }

    return map
        .values()
        .toArray()
        .sort((a, b) => {
            return Temporal.Instant.compare(a.bucket, b.bucket);
        });
}
