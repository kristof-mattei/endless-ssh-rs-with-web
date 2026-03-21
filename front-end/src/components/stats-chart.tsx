import type React from "react";
import type { ReactNode } from "react";
import { Suspense, lazy, useState } from "react";
import type { TooltipContentProps } from "recharts";
import {
    Bar,
    CartesianGrid,
    DefaultTooltipContent,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
    createHorizontalChart,
} from "recharts";

import type { Payload } from "recharts/types/component/DefaultTooltipContent";

import { formatBytes, formatDuration } from "../lib/formatting";

import type { StatsRow } from "./time-range-selector";

interface BucketPointValues {
    bytes_sent: number;
    connects: number;
    time_spent: number;
}

type Metric = keyof BucketPointValues;

type BucketPoint = {
    bucket: Date;
} & BucketPointValues;

const METRICS: readonly { value: Metric; label: string }[] = [
    { value: "connects", label: "Connections" },
    { value: "bytes_sent", label: "Bytes wasted" },
    { value: "time_spent", label: "Time wasted" },
];

const RechartsDevelopmentTools = import.meta.env.DEV
    ? lazy(async () => {
          const module = await import("@recharts/devtools");

          return { default: module.RechartsDevtools };
      })
    : () => {
          return null;
      };

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

function formatBucket(bucket: Date): string {
    // midnight == day-level bucket == show date only
    // this is actually bad, we want to know the scale we're working with, as passed on by the `rangeSelector`
    // because this heuristic is not always correct
    if (bucket.getUTCHours() === 0 && bucket.getUTCMinutes() === 0) {
        return bucket.toLocaleDateString([], { day: "numeric", month: "short" });
    }

    return bucket.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

// Mirrors the bucket selections buttons, and thus the backend's reprentation.
function getBucketIntervalMs(from: Date, to: Date): number {
    const MILLISECONDS_IN_SECOND = 1000;
    const SECONDS_IN_MINUTE = 60;
    const MINUTES_IN_HOUR = 60;
    const HOURS_IN_DAY = 24;

    const spanHours = (to.getTime() - from.getTime()) / (MILLISECONDS_IN_SECOND * SECONDS_IN_MINUTE * 60);

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

function aggregate(rows: StatsRow[], from: Date, to: Date): BucketPoint[] {
    const map = new Map<number, BucketPoint>();

    for (const row of rows) {
        const bucket = new Date(row.bucket);
        const key = bucket.getTime();
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
    const startMs = Math.ceil(from.getTime() / intervalMs) * intervalMs;

    for (let ms = startMs; ms < to.getTime(); ms += intervalMs) {
        if (!map.has(ms)) {
            map.set(ms, { bucket: new Date(ms), bytes_sent: 0, connects: 0, time_spent: 0 });
        }
    }

    return [...map.values()].sort((a, b) => {
        return a.bucket.getTime() - b.bucket.getTime();
    });
}

interface Properties {
    rows: StatsRow[];
    from: Date;
    to: Date;
}

export const CustomTooltipContent: (properties: TooltipContentProps) => React.JSX.Element = (
    properties: TooltipContentProps,
) => {
    // `payload[0].payload` is the full `BucketPoint`
    const payload = properties.payload as readonly Payload<number, string>[];
    const payload0 = payload[0];
    const bucketPoint = payload0?.payload as BucketPoint | undefined;

    if (bucketPoint === undefined) {
        // passthrough
        return <DefaultTooltipContent {...properties} />;
    }

    const allMetrics = METRICS.map((m) => {
        return {
            ...payload0,
            dataKey: m.value,
            name: m.label,
            value: bucketPoint[m.value],
            formatter: (v: number | undefined) => {
                return formatYLabel(m.value, v ?? 0);
            },
        } as Payload;
    });

    return <DefaultTooltipContent {...properties} payload={allMetrics} />;
};

export const StatsChart: React.FC<Properties> = ({ rows, from, to }) => {
    const [selectedMetric, setMetric] = useState<Metric>("connects");

    const points = aggregate(rows, from, to);

    const Typed = createHorizontalChart<BucketPoint, Date>()({
        XAxis,
        YAxis,
        Tooltip,
        Bar,
    });

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
                <ResponsiveContainer width="100%" height={220}>
                    <Typed.BarChart data={points} margin={{ bottom: 52, left: 8, right: 16, top: 8 }}>
                        <CartesianGrid stroke="#374151" strokeDasharray="3 3" vertical={false} />
                        <Typed.XAxis
                            axisLine={{ stroke: "#4b5563" }}
                            dataKey={(bp: BucketPoint) => {
                                return bp.bucket;
                            }}
                            tick={{ fill: "#6b7280", fontSize: 10 }}
                            tickFormatter={formatBucket}
                            tickLine={true}
                        />
                        <Typed.YAxis
                            tickFormatter={(v: number) => {
                                return formatYLabel(selectedMetric, v);
                            }}
                            tick={{ fill: "#9ca3af", fontSize: 11 }}
                            width={72}
                            axisLine={false}
                            tickLine={false}
                        />
                        <Typed.Tooltip
                            cursor={{ fill: "rgba(255,255,255,0.04)" }}
                            contentStyle={{
                                background: "#1f2937",
                                border: "1px solid #374151",
                                borderRadius: "6px",
                                color: "#e5e7eb",
                                fontSize: "12px",
                            }}
                            labelStyle={{ fontWeight: 600, color: "#e5e7eb", marginBottom: "4px" }}
                            itemStyle={{ color: "#9ca3af" }}
                            content={(properties) => {
                                return <CustomTooltipContent {...properties} />;
                            }}
                            labelFormatter={(label: ReactNode) => {
                                return label instanceof Date ? formatBucket(label) : label;
                            }}
                        />
                        {METRICS.map((m) => {
                            return (
                                <Typed.Bar
                                    key={m.value}
                                    dataKey={(p: BucketPoint) => {
                                        return p[m.value];
                                    }}
                                    name={m.label}
                                    fill="#2563eb"
                                    hide={m.value !== selectedMetric}
                                    radius={[2, 2, 0, 0]}
                                />
                            );
                        })}
                        {import.meta.env.DEV && (
                            <Suspense fallback={null}>
                                <RechartsDevelopmentTools />
                            </Suspense>
                        )}
                    </Typed.BarChart>
                </ResponsiveContainer>
            )}
        </div>
    );
};
