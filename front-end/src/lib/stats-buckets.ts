import { Temporal } from "temporal-polyfill";

import type { Country } from "../generated/Country";
import type { StatsRow } from "../generated/StatsRow";

export interface BucketPointValues {
    bytes_sent: number;
    connects: number;
    time_spent: number;
}

export type BucketPoint = {
    bucket: Temporal.Instant;
} & BucketPointValues;

// TimescaleDB's bucket origin, a Monday, so weekly buckets run Monday to Sunday. Every narrower width divides a day evenly, so only the weekly grid depends on the anchor.
const BUCKET_ANCHOR_MS = Temporal.Instant.from("2000-01-03T00:00:00Z").epochMilliseconds;

export function snapUpToBucket(ms: number, bucketWidthMs: number): number {
    return BUCKET_ANCHOR_MS + Math.ceil((ms - BUCKET_ANCHOR_MS) / bucketWidthMs) * bucketWidthMs;
}

export interface CountryTotals {
    bytes_sent: number;
    connects: number;
    country: Country | null;
    time_spent: number;
}

export function topCountries(rows: StatsRow[], limit: number): CountryTotals[] {
    const map = new Map<null | string, CountryTotals>();

    for (const row of rows) {
        const code = row.country?.code ?? null;
        const existing = map.get(code);

        if (existing === undefined) {
            map.set(code, {
                country: row.country,
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
        .sort((left, right) => {
            return right.connects - left.connects;
        })
        .slice(0, limit);
}

export interface InstantRange {
    from: Temporal.Instant;
    to: Temporal.Instant;
}

// the buckets rows sit on: [from, to) cut into buckets of the width the back-end aggregated at
export interface BucketGrid {
    bucketWidthMs: number;
    range: InstantRange;
}

export interface StatsData {
    grid: BucketGrid;
    rows: StatsRow[];
}

export function aggregate(rows: StatsRow[], { bucketWidthMs, range }: BucketGrid): BucketPoint[] {
    const map = new Map<number, BucketPoint>();

    for (const row of rows) {
        const key = row.bucket.epochMilliseconds;
        const existing = map.get(key);

        if (existing === undefined) {
            map.set(key, {
                bucket: row.bucket,
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
    const startMs = snapUpToBucket(range.from.epochMilliseconds, bucketWidthMs);

    for (let ms = startMs; ms < range.to.epochMilliseconds; ms += bucketWidthMs) {
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
        .sort((left, right) => {
            return Temporal.Instant.compare(left.bucket, right.bucket);
        });
}
