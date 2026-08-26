import { useQueryState } from "nuqs";
import type { Dispatch, ReactNode, SetStateAction } from "react";
import { useEffect, useState } from "react";
import { Bar, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, createHorizontalChart } from "recharts";
import { Temporal } from "temporal-polyfill";

import { DASHBOARD_PARAMS } from "../lib/dashboard-params";
import { METRICS, formatMetricValue } from "../lib/metrics";
import type { BucketGrid, BucketPoint, StatsData } from "../lib/stats-buckets";
import { aggregate, snapUpToBucket } from "../lib/stats-buckets";
import { StatsTooltip } from "./stats-tooltip";

// recharts hands axis values to d3, which coerces object keys via `valueOf()`.
// `Temporal.Instant.prototype.valueOf` throws by design, so the axis carries
// epoch milliseconds and formatters convert back to `Temporal.Instant`.
const Typed = createHorizontalChart<BucketPoint, number>()({
    XAxis,
    YAxis,
    Tooltip,
    Bar,
});

// Axis ticks and tooltip headers need different precision. Tick values from `getTickValues` sit on round boundaries (whole hours, midnights, month starts),
// while the tooltip shows a single bucket at the width the back-end aggregated at.
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

const DAY_MS = 24 * 60 * 60 * 1000;

function getBucketLabelOptions(bucketWidthMs: number): Intl.DateTimeFormatOptions {
    if (bucketWidthMs < DAY_MS) {
        return { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" };
    }

    return { day: "numeric", month: "short", year: "numeric" };
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
// a boundary is only a bucket when the UTC offset divides the bucket width.
function getTickValues({ bucketWidthMs, range }: BucketGrid): number[] {
    const spanHours = range.from.until(range.to).total("hours");
    const start = range.from.toZonedDateTimeISO(Temporal.Now.timeZoneId());
    const { first, step } = getFirstTickAndStep(start, spanHours);

    const endMs = range.to.epochMilliseconds;

    const values: number[] = [];

    for (let cursor = first; cursor.epochMilliseconds < endMs; cursor = cursor.add(step)) {
        const bucketMs = snapUpToBucket(cursor.epochMilliseconds, bucketWidthMs);

        if (bucketMs < endMs) {
            values.push(bucketMs);
        }
    }

    return values;
}

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

export const StatsChart: React.FC<StatsData> = ({ grid, rows }) => {
    const developmentTools = useRechartsDevtools();

    const [selectedMetric, setSelectedMetric] = useQueryState("metric", DASHBOARD_PARAMS.metric);

    const points = aggregate(rows, grid);

    const spanHours = grid.range.from.until(grid.range.to).total("hours");
    const formatTickLabel = getTickFormatter(spanHours);
    const bucketLabelOptions = getBucketLabelOptions(grid.bucketWidthMs);
    const tickValues = getTickValues(grid);

    return (
        <div className="rounded-lg bg-gray-800 p-4">
            <div className="mbe-3 flex items-center gap-2">
                {METRICS.map((metric) => {
                    return (
                        <button
                            aria-pressed={selectedMetric === metric.value}
                            className={`rounded-sm px-3 py-1 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 ${
                                selectedMetric === metric.value
                                    ? "bg-blue-600 text-white"
                                    : "bg-gray-700 text-gray-300 hover:bg-gray-600"
                            }`}
                            key={metric.value}
                            onClick={() => {
                                void setSelectedMetric(metric.value);
                            }}
                            type="button"
                        >
                            {metric.label}
                        </button>
                    );
                })}
            </div>

            {points.length === 0 ? (
                <p className="py-8 text-center text-gray-500">No data for selected range</p>
            ) : (
                <ResponsiveContainer height={220} width="100%">
                    <Typed.BarChart
                        className="focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
                        data={points}
                        margin={{ bottom: 8, left: 8, right: 16, top: 8 }}
                    >
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
                            tickLine
                            ticks={tickValues}
                        />
                        <Typed.YAxis
                            axisLine={false}
                            tick={{ fill: "#9ca3af", fontSize: 11 }}
                            tickFormatter={(value: number) => {
                                return formatMetricValue(selectedMetric, value);
                            }}
                            tickLine={false}
                            width="auto"
                        />
                        <Typed.Tooltip
                            content={StatsTooltip}
                            contentStyle={{
                                background: "#1f2937",
                                border: "1px solid #374151",
                                borderRadius: "6px",
                                color: "#e5e7eb",
                                fontSize: "12px",
                            }}
                            cursor={{ fill: "rgba(255,255,255,0.04)" }}
                            itemStyle={{ color: "#9ca3af" }}
                            labelFormatter={(label: ReactNode) => {
                                return typeof label === "number"
                                    ? Temporal.Instant.fromEpochMilliseconds(label).toLocaleString(
                                          [],
                                          bucketLabelOptions,
                                      )
                                    : label;
                            }}
                            labelStyle={{ fontWeight: 600, color: "#e5e7eb", marginBottom: "4px" }}
                        />
                        {METRICS.map((metric) => {
                            return (
                                <Typed.Bar
                                    dataKey={(point: BucketPoint) => {
                                        return point[metric.value];
                                    }}
                                    fill="#2563eb"
                                    hide={metric.value !== selectedMetric}
                                    key={metric.value}
                                    name={metric.label}
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
