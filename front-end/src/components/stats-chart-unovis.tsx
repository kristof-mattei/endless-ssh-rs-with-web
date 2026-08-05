import { VisAxis, VisCrosshair, VisStackedBar, VisTooltip, VisXYContainer } from "@unovis/react";
import { Temporal } from "temporal-polyfill";

import { getBucketLabelOptions, getTickFormatter, getTickValues } from "../lib/chart-ticks";
import type { Metric } from "../lib/metrics";
import { formatMetricValue, METRIC_KEYS, METRICS } from "../lib/metrics";
import type { BucketGrid, BucketPoint } from "../lib/stats-buckets";

// The scales coerce data values through `valueOf()`, and `Temporal.Instant.prototype.valueOf` throws by
// design, so the axis carries epoch milliseconds and the formatters convert back to `Temporal.Instant`.
function getBucketMs(point: BucketPoint): number {
    return point.bucket.epochMilliseconds;
}

const CHART_HEIGHT = 220;

const BAR_COLOR = "#2563eb";

const CHART_STYLE: Record<`--${string}`, string> = {
    "--vis-axis-domain-color": "#4b5563",
    "--vis-axis-grid-color": "#374151",
    "--vis-axis-grid-line-dasharray": "3 3",
    "--vis-axis-tick-color": "#4b5563",
    "--vis-crosshair-circle-stroke-color": "#1f2937",
    "--vis-crosshair-line-stroke-color": "rgba(255,255,255,0.2)",
    "--vis-tooltip-background-color": "#1f2937",
    "--vis-tooltip-border-color": "#374151",
    "--vis-tooltip-border-radius": "6px",
    "--vis-tooltip-text-color": "#e5e7eb",
};

// The tooltip lives outside React's tree, so it is built as a detached element instead of a
// markup string: every value reaches the DOM as text and never as HTML.
function createTooltip(point: BucketPoint, labelOptions: Intl.DateTimeFormatOptions): HTMLElement {
    const root = document.createElement("div");

    root.style.fontSize = "12px";

    const label = document.createElement("div");

    label.style.fontWeight = "600";
    label.style.marginBlockEnd = "4px";
    label.textContent = point.bucket.toLocaleString([], labelOptions);

    root.append(label);

    for (const metric of METRIC_KEYS) {
        const item = document.createElement("div");

        item.style.color = "#9ca3af";
        item.textContent = `${METRICS[metric].label}: ${formatMetricValue(metric, point[metric])}`;

        root.append(item);
    }

    return root;
}

interface Properties {
    grid: BucketGrid;
    points: BucketPoint[];
    selectedMetric: Metric;
}

export const UnovisStatsChart: React.FC<Properties> = ({ grid, points, selectedMetric }) => {
    const spanHours = grid.range.from.until(grid.range.to).total("hours");
    const formatTickLabel = getTickFormatter(spanHours);
    const bucketLabelOptions = getBucketLabelOptions(grid.bucketWidthMs);
    const tickValues = getTickValues(grid);

    const getMetricValue = (point: BucketPoint): number => {
        return point[selectedMetric];
    };

    return (
        <VisXYContainer<BucketPoint>
            ariaLabel="Connections, bytes wasted and time wasted per time bucket"
            data={points}
            height={CHART_HEIGHT}
            style={CHART_STYLE}
            yDomain={[0, undefined]}
        >
            <VisStackedBar<BucketPoint>
                barPadding={0.15}
                color={BAR_COLOR}
                // bar width follows the bucket width, not the data density
                dataStep={grid.bucketWidthMs}
                roundedCorners={2}
                x={getBucketMs}
                y={getMetricValue}
            />
            <VisAxis<BucketPoint>
                gridLine={false}
                tickFormat={(tick: Date | number) => {
                    return formatTickLabel(Temporal.Instant.fromEpochMilliseconds(Number(tick)));
                }}
                tickTextColor="#6b7280"
                tickTextFontSize="10px"
                tickValues={tickValues}
                type="x"
            />
            <VisAxis<BucketPoint>
                domainLine={false}
                numTicks={5}
                tickFormat={(tick: Date | number) => {
                    return formatMetricValue(selectedMetric, Number(tick));
                }}
                tickLine={false}
                tickTextColor="#9ca3af"
                tickTextFontSize="11px"
                type="y"
            />
            <VisCrosshair<BucketPoint>
                color={BAR_COLOR}
                template={(point: BucketPoint) => {
                    return createTooltip(point, bucketLabelOptions);
                }}
                x={getBucketMs}
                y={getMetricValue}
            />
            <VisTooltip />
        </VisXYContainer>
    );
};
