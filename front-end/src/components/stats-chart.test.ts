import { Temporal } from "temporal-polyfill";
import { describe, expect, it } from "vitest";

import type { StatsRow } from "../generated/StatsRow";

import { aggregate } from "../lib/stats-buckets";

const MINUTE_MS = 60_000;

function row(bucket: string, overrides?: Partial<Omit<StatsRow, "bucket">>): StatsRow {
    return {
        bucket,
        country_code: "US",
        connects: 1,
        time_spent: 10,
        bytes_sent: 100,
        ...overrides,
    };
}

function instant(iso: string): Temporal.Instant {
    return Temporal.Instant.from(iso);
}

describe("aggregate", () => {
    it("sums the per-country rows of one bucket", () => {
        const points = aggregate(
            [
                row("2026-01-01T00:01:00Z", { country_code: "US", connects: 2, time_spent: 10, bytes_sent: 100 }),
                row("2026-01-01T00:01:00Z", { country_code: "DE", connects: 3, time_spent: 5, bytes_sent: 50 }),
            ],
            instant("2026-01-01T00:01:00Z"),
            instant("2026-01-01T00:02:00Z"),
            MINUTE_MS,
        );

        expect(points).toHaveLength(1);
        expect(points[0]).toMatchObject({ connects: 5, time_spent: 15, bytes_sent: 150 });
    });

    it("zero-fills every empty bucket in [from, to)", () => {
        const points = aggregate(
            [row("2026-01-01T00:01:00Z")],
            instant("2026-01-01T00:00:00Z"),
            instant("2026-01-01T00:05:00Z"),
            MINUTE_MS,
        );

        expect(
            points.map((p) => {
                return p.connects;
            }),
        ).toEqual([0, 1, 0, 0, 0]);
    });

    it("aligns the zero-fill to the bucket grid when from is unaligned", () => {
        const points = aggregate([], instant("2026-01-01T00:00:30Z"), instant("2026-01-01T00:05:00Z"), MINUTE_MS);

        expect(
            points.map((p) => {
                return p.bucket.toString();
            }),
        ).toEqual(["2026-01-01T00:01:00Z", "2026-01-01T00:02:00Z", "2026-01-01T00:03:00Z", "2026-01-01T00:04:00Z"]);
    });

    it("sorts buckets ascending regardless of row order", () => {
        const points = aggregate(
            [row("2026-01-01T00:03:00Z"), row("2026-01-01T00:01:00Z")],
            instant("2026-01-01T00:01:00Z"),
            instant("2026-01-01T00:04:00Z"),
            MINUTE_MS,
        );

        expect(
            points.map((p) => {
                return p.bucket.toString();
            }),
        ).toEqual(["2026-01-01T00:01:00Z", "2026-01-01T00:02:00Z", "2026-01-01T00:03:00Z"]);
    });
});
