import { VisAxis, VisCrosshair, VisStackedBar, VisTooltip, VisXYContainer } from "@unovis/react";
import { useState } from "react";

import { Temporal } from "temporal-polyfill";

import { formatBytes, formatDuration } from "../lib/formatting";

import type { StatsRow } from "./time-range-selector";

interface BucketPointValues {
    bytes_sent: number;
    connects: number;
    time_spent: number;
}

type Metric = keyof BucketPointValues;

type BucketPoint = {
    bucket: Temporal.Instant;
} & BucketPointValues;

const METRICS: ReadonlyArray<{ value: Metric; label: string }> = [
    { value: "connects", label: "Connections" },
    { value: "bytes_sent", label: "Bytes wasted" },
    { value: "time_spent", label: "Time wasted" },
];

function formatYLabel(metric: Metric, value: number): string {
    switch (metric) {
        case "bytes_sent": {
            return formatBytes(value);
        }
        case "time_spent": {
            return formatDuration(value);
        }
        default: {
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

function formatBucket(bucket: Temporal.Instant): string {
    // midnight == day-level bucket == show date only
    // this is actually bad, we want to know the scale we're working with, as passed on by the `rangeSelector`
    // because this heuristic is not always correct
    const utc = bucket.toZonedDateTimeISO("UTC");

    if (utc.hour === 0 && utc.minute === 0) {
        return bucket.toLocaleString([], { day: "numeric", month: "short" });
    }

    return bucket.toLocaleString([], { hour: "2-digit", minute: "2-digit" });
}

// Mirrors the bucket selections buttons, and thus the backend's representation.
function getBucketIntervalMs(from: Temporal.Instant, to: Temporal.Instant): number {
    const MILLISECONDS_IN_SECOND = 1000;
    const SECONDS_IN_MINUTE = 60;
    const MINUTES_IN_HOUR = 60;
    const HOURS_IN_DAY = 24;

    const spanHours = from.until(to).total("hours");

    // last hour & last 24 hours
    if (spanHours <= 24) {
        // 1 min buckets
        return SECONDS_IN_MINUTE * MILLISECONDS_IN_SECOND;
    }

    // last 7 days
    if (spanHours <= 24 * 7) {
        // 5 min buckets
        return 5 * SECONDS_IN_MINUTE * MILLISECONDS_IN_SECOND;
    }

    // last 30 days
    if (spanHours <= 24 * 30) {
        // 1 hour buckets
        return MINUTES_IN_HOUR * SECONDS_IN_MINUTE * MILLISECONDS_IN_SECOND;
    }

    // all time
    // 1 day buckets
    return HOURS_IN_DAY * MINUTES_IN_HOUR * SECONDS_IN_MINUTE * MILLISECONDS_IN_SECOND;
}

function aggregate(rows: StatsRow[], from: Temporal.Instant, to: Temporal.Instant): BucketPoint[] {
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
    const intervalMs = getBucketIntervalMs(from, to);
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

const CHART_HEIGHT = 220;

const CHART_STYLE: Record<`--${string}`, string> = {
    "--vis-axis-domain-color": "#4b5563",
    "--vis-axis-grid-color": "#374151",
    "--vis-axis-tick-color": "#4b5563",
    "--vis-axis-tick-label-color": "#9ca3af",
    "--vis-axis-tick-label-font-size": "11px",
    "--vis-crosshair-circle-stroke-color": "#1f2937",
    "--vis-crosshair-line-stroke-color": "rgba(255,255,255,0.2)",
    "--vis-tooltip-background-color": "#1f2937",
    "--vis-tooltip-border-color": "#374151",
    "--vis-tooltip-border-radius": "6px",
    "--vis-tooltip-text-color": "#e5e7eb",
};

interface Properties {
    rows: StatsRow[];
    from: Temporal.Instant;
    to: Temporal.Instant;
}

export const StatsChart: React.FC<Properties> = ({ rows, from, to }) => {
    const [selectedMetric, setMetric] = useState<Metric>("connects");

    const points = aggregate(rows, from, to);

    const tooltipTemplate = (point: BucketPoint): string => {
        const metricRows = METRICS.map((metric) => {
            return `<div style="color:#9ca3af">${metric.label}: ${formatYLabel(metric.value, point[metric.value])}</div>`;
        }).join("");

        return `<div style="font-weight:600;margin-bottom:4px">${formatBucket(point.bucket)}</div>${metricRows}`;
    };

    return (
        <div className="rounded-lg bg-gray-800 p-4">
            <div className="mb-3 flex items-center gap-2">
                {METRICS.map((metric) => {
                    return (
                        <button
                            key={metric.value}
                            type="button"
                            onClick={() => {
                                setMetric(metric.value);
                            }}
                            className={`rounded px-3 py-1 text-sm transition-colors ${
                                selectedMetric === metric.value
                                    ? "bg-blue-600 text-white"
                                    : "bg-gray-700 text-gray-300 hover:bg-gray-600"
                            }`}
                        >
                            {metric.label}
                        </button>
                    );
                })}
            </div>

            {points.length === 0 ? (
                <p className="py-8 text-center text-gray-500">No data for selected range</p>
            ) : (
                <VisXYContainer<BucketPoint>
                    data={points}
                    height={CHART_HEIGHT}
                    style={CHART_STYLE}
                    yDomain={[0, undefined]}
                >
                    <VisStackedBar<BucketPoint>
                        x={(point: BucketPoint) => {
                            return point.bucket.epochMilliseconds;
                        }}
                        y={(point: BucketPoint) => {
                            return point[selectedMetric];
                        }}
                        color="#2563eb"
                        barPadding={0.15}
                        roundedCorners={2}
                    />
                    <VisAxis<BucketPoint>
                        type="x"
                        numTicks={6}
                        gridLine={false}
                        tickFormat={(tick: Date | number) => {
                            return formatBucket(Temporal.Instant.fromEpochMilliseconds(Number(tick)));
                        }}
                    />
                    <VisAxis<BucketPoint>
                        type="y"
                        numTicks={4}
                        domainLine={false}
                        tickLine={false}
                        tickFormat={(tick: Date | number) => {
                            return formatYLabel(selectedMetric, Number(tick));
                        }}
                    />
                    <VisCrosshair<BucketPoint> template={tooltipTemplate} color="#2563eb" />
                    <VisTooltip />
                </VisXYContainer>
            )}
        </div>
    );
};
