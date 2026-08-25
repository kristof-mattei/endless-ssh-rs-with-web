import { formatBytes, formatDuration } from "./formatting";
import type { BucketPointValues } from "./stats-buckets";

export type Metric = keyof BucketPointValues;

export const METRICS: readonly { label: string; value: Metric }[] = [
    { label: "Connections", value: "connects" },
    { label: "Bytes wasted", value: "bytes_sent" },
    { label: "Time wasted", value: "time_spent" },
];

// Shared by the chart's y axis and its tooltip, so both render a metric the same way.
export function formatMetricValue(metric: Metric, value: number): string {
    switch (metric) {
        case "bytes_sent": {
            return formatBytes(value);
        }
        case "time_spent": {
            return formatDuration(value);
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
