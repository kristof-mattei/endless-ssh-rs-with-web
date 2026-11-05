import type { Dispatch, ReactNode, SetStateAction } from "react";
import { useEffect, useState } from "react";
import { Bar, CartesianGrid, createHorizontalChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { getBucketLabelOptions, getTickFormatter, getTickValues } from "../lib/chart-ticks";
import type { Metric } from "../lib/metrics";
import { formatMetricValue, METRIC_KEYS, METRICS } from "../lib/metrics";
import type { BucketGrid, BucketPoint } from "../lib/stats-buckets";
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

function useRechartsDevtools(): DevelopmentToolsState {
    const [devtools, setDevtools] = useState<DevelopmentToolsState>(null);

    useEffect(() => {
        if (import.meta.env.DEV) {
            void loadDevelopmentTools(setDevtools);
        }
    }, []);

    return devtools;
}

interface Properties {
    grid: BucketGrid;
    points: BucketPoint[];
    selectedMetric: Metric;
}

export const StatsBarChart: React.FC<Properties> = ({ grid, points, selectedMetric }) => {
    const developmentTools = useRechartsDevtools();

    const spanHours = grid.range.from.until(grid.range.to).total("hours");
    const formatTickLabel = getTickFormatter(spanHours);
    const bucketLabelOptions = getBucketLabelOptions(grid.bucketWidthMs);
    const tickValues = getTickValues(grid);

    return (
        <>
            <ResponsiveContainer height={220} width="100%">
                <Typed.BarChart
                    className="focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
                    data={points}
                    margin={{ bottom: 8, left: 8, right: 16, top: 8 }}
                >
                    <CartesianGrid stroke="var(--color-line)" strokeDasharray="3 3" vertical={false} />
                    <Typed.XAxis
                        axisLine={{ stroke: "var(--color-line-strong)" }}
                        dataKey={(bp: BucketPoint) => {
                            return bp.bucket.epochMilliseconds;
                        }}
                        height="auto"
                        interval={0}
                        tick={{ fill: "var(--color-fg-subtle)", fontSize: 10 }}
                        tickFormatter={(ms: number) => {
                            return formatTickLabel(Temporal.Instant.fromEpochMilliseconds(ms));
                        }}
                        tickLine
                        ticks={tickValues}
                    />
                    <Typed.YAxis
                        axisLine={false}
                        tick={{ fill: "var(--color-fg-muted)", fontSize: 11 }}
                        tickFormatter={(value: number) => {
                            return formatMetricValue(selectedMetric, value);
                        }}
                        tickLine={false}
                        width="auto"
                    />
                    <Typed.Tooltip
                        content={StatsTooltip}
                        contentStyle={{
                            background: "var(--color-panel)",
                            border: "1px solid var(--color-line)",
                            borderRadius: "6px",
                            color: "var(--color-fg)",
                            fontSize: "12px",
                        }}
                        cursor={{ fill: "var(--color-highlight)" }}
                        itemStyle={{ color: "var(--color-fg-muted)" }}
                        // oxlint-disable-next-line typescript/promise-function-async -- ReactNode includes Promise
                        labelFormatter={(label: ReactNode) => {
                            return typeof label === "number"
                                ? Temporal.Instant.fromEpochMilliseconds(label).toLocaleString([], bucketLabelOptions)
                                : label;
                        }}
                        labelStyle={{ fontWeight: 600, color: "var(--color-fg)", marginBottom: "4px" }}
                    />
                    {METRIC_KEYS.map((metric) => {
                        return (
                            <Typed.Bar
                                dataKey={(point: BucketPoint) => {
                                    return point[metric];
                                }}
                                fill="var(--color-blue-600)"
                                hide={metric !== selectedMetric}
                                key={metric}
                                name={METRICS[metric].label}
                                radius={[2, 2, 0, 0]}
                            />
                        );
                    })}
                    {developmentTools !== null && <developmentTools.Component />}
                </Typed.BarChart>
            </ResponsiveContainer>
            {developmentTools !== null && <div id={developmentTools.portalId} />}
        </>
    );
};
