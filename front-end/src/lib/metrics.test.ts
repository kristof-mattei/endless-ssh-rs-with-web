import { describe, expect, it, vi } from "vitest";

import { formatMetricValue } from "./metrics";

vi.setConfig({ testTimeout: 1000 });

describe("formatMetricValue", () => {
    it("renders time spent from seconds", () => {
        expect(formatMetricValue("time_spent", 125)).toBe("2m 5s");
    });

    it("truncates a fractional axis tick for time spent", () => {
        expect(formatMetricValue("time_spent", 2.5)).toBe("2s");
    });
});
