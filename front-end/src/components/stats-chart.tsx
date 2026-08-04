import type { Dispatch, ReactNode, SetStateAction } from "react";
import { useEffect, useState } from "react";
import type { TooltipContentProps } from "recharts";
import { Bar, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, createHorizontalChart } from "recharts";

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

// Axis ticks and tooltip headers need different precision. Tick values from `getTickValues` sit on round boundaries (whole hours, midnights, month starts),
// while the tooltip shows a single bucket at the interval from `getBucketIntervalMs`.
function formatDayTick(instant: Temporal.Instant): string {
    return instant.toLocaleString([], { day: "numeric", month: "short" });
}

function formatMonthTick(instant: Temporal.Instant): string {
    return instant.toLocaleString([], { month: "short", year: "numeric" });
}

function getTickFormatter(spanHours: number): (instant: Temporal.Instant) => string {
    if (spanHours <= 24) {
        const timeZone = Temporal.Now.timeZoneId();

        return (instant) => {
            const local = instant.toZonedDateTimeISO(timeZone);

            // a midnight tick is the day crossing, label it with the date
            if (local.hour === 0 && local.minute === 0) {
                return formatDayTick(instant);
            }

            return instant.toLocaleString([], { hour: "2-digit", minute: "2-digit" });
        };
    }

    if (spanHours <= 24 * 30) {
        return formatDayTick;
    }

    return formatMonthTick;
}

function getBucketLabelOptions(spanHours: number): Intl.DateTimeFormatOptions {
    if (spanHours <= 24) {
        return { hour: "2-digit", minute: "2-digit" };
    }

    if (spanHours <= 24 * 30) {
        return { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" };
    }

    return { day: "numeric", month: "short", year: "numeric" };
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

function getFirstTickAndStep(
    start: Temporal.ZonedDateTime,
    spanHours: number,
): { first: Temporal.ZonedDateTime; step: Temporal.DurationLike } {
    if (spanHours <= 1) {
        return {
            first: start.round({ smallestUnit: "minute", roundingIncrement: 15, roundingMode: "ceil" }),
            step: { minutes: 15 },
        };
    }

    if (spanHours <= 24) {
        return {
            first: start.round({ smallestUnit: "hour", roundingIncrement: 3, roundingMode: "ceil" }),
            step: { hours: 3 },
        };
    }

    const midnight = start.round({ smallestUnit: "day", roundingMode: "ceil" });

    if (spanHours <= 24 * 7) {
        return { first: midnight, step: { days: 1 } };
    }

    if (spanHours <= 24 * 30) {
        // week ticks start on Sunday
        return { first: midnight.add({ days: (7 - midnight.dayOfWeek) % 7 }), step: { weeks: 1 } };
    }

    let monthStart = midnight.with({ day: 1 });

    if (Temporal.ZonedDateTime.compare(monthStart, start) < 0) {
        monthStart = monthStart.add({ months: 1 });
    }

    // month ticks start on quarters
    return { first: monthStart.add({ months: (3 - ((monthStart.month - 1) % 3)) % 3 }), step: { months: 3 } };
}

// The x axis is categorical, one band per bucket, so recharts' default ticks land on arbitrary buckets.
// Tick values are computed on local calendar boundaries instead, then snapped up to the bucket grid because
// a boundary is only a bucket when the UTC offset divides the bucket interval.
function getTickValues(from: Temporal.Instant, to: Temporal.Instant): number[] {
    const spanHours = from.until(to).total("hours");
    const start = from.toZonedDateTimeISO(Temporal.Now.timeZoneId());
    const { first, step } = getFirstTickAndStep(start, spanHours);

    const intervalMs = getBucketIntervalMs(from, to);
    const endMs = to.epochMilliseconds;

    const values: number[] = [];

    for (let cursor = first; cursor.epochMilliseconds < endMs; cursor = cursor.add(step)) {
        const bucketMs = Math.ceil(cursor.epochMilliseconds / intervalMs) * intervalMs;

        if (bucketMs < endMs) {
            values.push(bucketMs);
        }
    }

    return values;
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

interface Properties {
    rows: StatsRow[];
    from: Temporal.Instant;
    to: Temporal.Instant;
}

function isBucketPoint(value: unknown): value is BucketPoint {
    return typeof value === "object" && value !== null && "bucket" in value;
}

// recharts' `DefaultTooltipContent` is declared without generics, so rendering the
// content ourselves is the only way to keep the chart's narrowed types. Markup and
// base styles mirror theirs.
export const CustomTooltipContent: (
    properties: TooltipContentProps<number, keyof BucketPoint>,
) => null | React.JSX.Element = ({ contentStyle, itemStyle, label, labelFormatter, labelStyle, payload }) => {
    const payload0 = payload[0];

    if (payload0 === undefined || !isBucketPoint(payload0.payload)) {
        return null;
    }

    const bucketPoint = payload0.payload;
    const formattedLabel = labelFormatter === undefined ? label : labelFormatter(label, payload);

    return (
        <div
            className="recharts-default-tooltip"
            style={{ margin: 0, padding: 10, whiteSpace: "nowrap", ...contentStyle }}
        >
            <p className="recharts-tooltip-label" style={{ margin: 0, ...labelStyle }}>
                {formattedLabel}
            </p>
            <ul className="recharts-tooltip-item-list" style={{ margin: 0, padding: 0 }}>
                {METRICS.map((metric) => {
                    return (
                        <li
                            key={metric.value}
                            className="recharts-tooltip-item"
                            style={{ display: "block", paddingBottom: 4, paddingTop: 4, ...itemStyle }}
                        >
                            <span className="recharts-tooltip-item-name">{metric.label}</span>
                            <span className="recharts-tooltip-item-separator">{": "}</span>
                            <span className="recharts-tooltip-item-value">
                                {formatYLabel(metric.value, bucketPoint[metric.value])}
                            </span>
                        </li>
                    );
                })}
            </ul>
        </div>
    );
};

type DevelopmentToolsState = {
    Component: () => React.JSX.Element;
    portalId: string;
} | null;

async function loadDevelopmentTools(setDevtools: Dispatch<SetStateAction<DevelopmentToolsState>>): Promise<void> {
    const module = await import("@recharts/devtools");

    setDevtools({
        Component: module.RechartsDevtools,
        portalId: module.RECHARTS_DEVTOOLS_PORTAL_ID,
    });
}

function useRechartsDevtools(): {
    Component: () => React.JSX.Element;
    portalId: string;
} | null {
    const [devtools, setDevtools] = useState<DevelopmentToolsState>(null);

    useEffect(() => {
        if (import.meta.env.DEV) {
            void loadDevelopmentTools(setDevtools);
        }
    }, []);

    return devtools;
}

export const StatsChart: React.FC<Properties> = ({ rows, from, to }) => {
    const developmentTools = useRechartsDevtools();

    const [selectedMetric, setMetric] = useState<Metric>("connects");

    const points = aggregate(rows, from, to);

    const spanHours = from.until(to).total("hours");
    const formatTickLabel = getTickFormatter(spanHours);
    const bucketLabelOptions = getBucketLabelOptions(spanHours);
    const tickValues = getTickValues(from, to);

    // recharts hands axis values to d3, which coerces object keys via `valueOf()`.
    // `Temporal.Instant.prototype.valueOf` throws by design, so the axis carries
    // epoch milliseconds and formatters convert back to `Temporal.Instant`.
    const Typed = createHorizontalChart<BucketPoint, number>()({
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
                            className={`rounded-sm px-3 py-1 text-sm transition-colors ${
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
                    <Typed.BarChart data={points} margin={{ bottom: 8, left: 8, right: 16, top: 8 }}>
                        <CartesianGrid stroke="#374151" strokeDasharray="3 3" vertical={false} />
                        <Typed.XAxis
                            axisLine={{ stroke: "#4b5563" }}
                            dataKey={(bp: BucketPoint) => {
                                return bp.bucket.epochMilliseconds;
                            }}
                            height="auto"
                            interval={0}
                            tick={{ fill: "#6b7280", fontSize: 10 }}
                            tickFormatter={(ms: number) => {
                                return formatTickLabel(Temporal.Instant.fromEpochMilliseconds(ms));
                            }}
                            tickLine={true}
                            ticks={tickValues}
                        />
                        <Typed.YAxis
                            tickFormatter={(v: number) => {
                                return formatYLabel(selectedMetric, v);
                            }}
                            tick={{ fill: "#9ca3af", fontSize: 11 }}
                            width="auto"
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
                                return typeof label === "number"
                                    ? Temporal.Instant.fromEpochMilliseconds(label).toLocaleString(
                                          [],
                                          bucketLabelOptions,
                                      )
                                    : label;
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
                        {developmentTools !== null && <developmentTools.Component />}
                    </Typed.BarChart>
                </ResponsiveContainer>
            )}
            {developmentTools !== null && <div id={developmentTools.portalId} />}
        </div>
    );
};
