import { Temporal } from "temporal-polyfill";
import { describe, expect, it } from "vitest";

import type { StatsRow } from "../generated/StatsRow";
import { aggregate, topCountries } from "./stats-buckets";

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
            { from: instant("2026-01-01T00:01:00Z"), to: instant("2026-01-01T00:02:00Z") },
            MINUTE_MS,
        );

        expect(points).toHaveLength(1);
        expect(points[0]).toMatchObject({ connects: 5, time_spent: 15, bytes_sent: 150 });
    });

    it("zero-fills every empty bucket in [from, to)", () => {
        const points = aggregate(
            [row("2026-01-01T00:01:00Z")],
            { from: instant("2026-01-01T00:00:00Z"), to: instant("2026-01-01T00:05:00Z") },
            MINUTE_MS,
        );

        expect(
            points.map((point) => {
                return point.connects;
            }),
        ).toEqual([0, 1, 0, 0, 0]);
    });

    it("aligns the zero-fill to the bucket grid when from is unaligned", () => {
        const points = aggregate(
            [],
            { from: instant("2026-01-01T00:00:30Z"), to: instant("2026-01-01T00:05:00Z") },
            MINUTE_MS,
        );

        expect(
            points.map((point) => {
                return point.bucket.toString();
            }),
        ).toEqual(["2026-01-01T00:01:00Z", "2026-01-01T00:02:00Z", "2026-01-01T00:03:00Z", "2026-01-01T00:04:00Z"]);
    });

    it("anchors weekly buckets on Mondays like TimescaleDB", () => {
        const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

        const points = aggregate(
            [],
            { from: instant("2026-01-01T00:00:00Z"), to: instant("2026-01-20T00:00:00Z") },
            WEEK_MS,
        );

        expect(
            points.map((point) => {
                return point.bucket.toString();
            }),
        ).toEqual(["2026-01-05T00:00:00Z", "2026-01-12T00:00:00Z", "2026-01-19T00:00:00Z"]);
    });

    it("sorts buckets ascending regardless of row order", () => {
        const points = aggregate(
            [row("2026-01-01T00:03:00Z"), row("2026-01-01T00:01:00Z")],
            { from: instant("2026-01-01T00:01:00Z"), to: instant("2026-01-01T00:04:00Z") },
            MINUTE_MS,
        );

        expect(
            points.map((point) => {
                return point.bucket.toString();
            }),
        ).toEqual(["2026-01-01T00:01:00Z", "2026-01-01T00:02:00Z", "2026-01-01T00:03:00Z"]);
    });
});

describe("topCountries", () => {
    it("sums a country across buckets", () => {
        const totals = topCountries(
            [
                row("2026-01-01T00:01:00Z", { connects: 2, bytes_sent: 100 }),
                row("2026-01-01T00:02:00Z", { connects: 3, bytes_sent: 50 }),
            ],
            5,
        );

        expect(totals).toEqual([{ country_code: "US", connects: 5, bytes_sent: 150, time_spent: 20 }]);
    });

    it("sorts by connects descending and truncates to the limit", () => {
        const totals = topCountries(
            [
                row("2026-01-01T00:01:00Z", { country_code: "US", connects: 1 }),
                row("2026-01-01T00:01:00Z", { country_code: "DE", connects: 3 }),
                row("2026-01-01T00:01:00Z", { country_code: "FR", connects: 2 }),
            ],
            2,
        );

        expect(
            totals.map((total) => {
                return total.country_code;
            }),
        ).toEqual(["DE", "FR"]);
    });

    it("groups rows without a country under one entry", () => {
        const totals = topCountries(
            [
                row("2026-01-01T00:01:00Z", { country_code: null, connects: 1 }),
                row("2026-01-01T00:02:00Z", { country_code: null, connects: 1 }),
            ],
            5,
        );

        expect(totals).toHaveLength(1);
        expect(totals[0]).toMatchObject({ country_code: null, connects: 2 });
    });
});
