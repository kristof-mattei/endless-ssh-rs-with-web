import { Temporal } from "temporal-polyfill";

import { formatBytes, formatDuration } from "./formatting";

// the chart's metrics, in display order
export const METRIC_KEYS = ["connects", "bytes_sent", "time_spent"] as const;

export type Metric = (typeof METRIC_KEYS)[number];

export const METRICS: Readonly<Record<Metric, { label: string }>> = {
    connects: { label: "Connections" },
    bytes_sent: { label: "Bytes wasted" },
    time_spent: { label: "Time wasted" },
};

// Shared by the chart's y axis and its tooltip, so both render a metric the same way.
export function formatMetricValue(metric: Metric, value: number): string {
    switch (metric) {
        case "bytes_sent": {
            return formatBytes(value);
        }
        case "time_spent": {
            // axis ticks can be fractional, `Temporal.Duration.from` only takes integer fields
            return formatDuration(Temporal.Duration.from({ seconds: Math.trunc(value) }));
        }
        case "connects": {
            if (value >= 1_000_000) {
                return `${(value / 1_000_000).toFixed(1)}M`;
            }
            if (value >= 1000) {
                return `${(value / 1000).toFixed(1)}k`;
            }
            return value.toFixed(0);
        }
    }
}
