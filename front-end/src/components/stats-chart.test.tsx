import { render, screen } from "@testing-library/react";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import { describe, expect, it, vi } from "vitest";

import type { BucketGrid } from "../lib/stats-buckets";
import { StatsChart } from "./stats-chart";

vi.setConfig({ testTimeout: 1000 });

const FROM = Temporal.Instant.from("2026-08-01T00:00:00Z");
const TO = Temporal.Instant.from("2026-08-01T01:00:00Z");
const GRID: BucketGrid = { bucketWidthMs: 60 * 1000, range: { from: FROM, to: TO } };

describe("StatsChart", () => {
    it("reports an empty range", () => {
        render(<StatsChart grid={{ ...GRID, range: { from: TO, to: TO } }} rows={[]} />, {
            wrapper: NuqsTestingAdapter,
        });

        expect(screen.getByText("No data for selected range")).toBeDefined();
    });
});
