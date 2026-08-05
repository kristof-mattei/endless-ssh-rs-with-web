import { fireEvent, render, screen } from "@testing-library/react";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import { Temporal } from "temporal-polyfill";
import { describe, expect, it, vi } from "vitest";

import type { StatsRow } from "../generated/StatsRow";
import type { BucketGrid } from "../lib/stats-buckets";
import { StatsChart } from "./stats-chart";

vi.setConfig({ testTimeout: 1000 });

const FROM = Temporal.Instant.from("2026-08-01T00:00:00Z");
const TO = Temporal.Instant.from("2026-08-01T01:00:00Z");
const GRID: BucketGrid = { bucketWidthMs: 60 * 1000, range: { from: FROM, to: TO } };

const UNOVIS_LABEL = "Connections, bytes wasted and time wasted per time bucket";

function row(bucket: string, connects: number): StatsRow {
    return {
        bucket: Temporal.Instant.from(bucket),
        bytes_sent: connects * 1024,
        connects,
        country: null,
        time_spent: connects * 1000,
    };
}

const ROWS = [row("2026-08-01T00:00:00Z", 3), row("2026-08-01T00:01:00Z", 7)];

describe("StatsChart", () => {
    it("starts on recharts", () => {
        render(<StatsChart grid={GRID} rows={ROWS} />, { wrapper: NuqsTestingAdapter });

        expect(screen.getByRole("radio", { name: "recharts" })).toHaveProperty("checked", true);
        expect(screen.getByRole("radio", { name: "unovis" })).toHaveProperty("checked", false);
        expect(screen.queryByLabelText(UNOVIS_LABEL)).toBeNull();
    });

    // the unovis chart labels its container one animation frame after mount, so the query has to wait for it
    it("switches to unovis", async () => {
        expect.hasAssertions();

        render(<StatsChart grid={GRID} rows={ROWS} />, { wrapper: NuqsTestingAdapter });

        fireEvent.click(screen.getByRole("radio", { name: "unovis" }));

        expect(await screen.findByLabelText(UNOVIS_LABEL)).toBeDefined();
        expect(screen.getByRole("radio", { name: "recharts" })).toHaveProperty("checked", false);
    });

    it("reports an empty range", () => {
        render(<StatsChart grid={{ ...GRID, range: { from: TO, to: TO } }} rows={[]} />, {
            wrapper: NuqsTestingAdapter,
        });

        expect(screen.getByText("No data for selected range")).toBeDefined();
    });
});
