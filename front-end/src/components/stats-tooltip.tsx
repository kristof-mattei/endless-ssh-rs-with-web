import type React from "react";
import type { TooltipContentProps } from "recharts";

import { METRICS, METRIC_KEYS, formatMetricValue } from "../lib/metrics";
import type { BucketPoint } from "../lib/stats-buckets";

function isBucketPoint(value: unknown): value is BucketPoint {
    return typeof value === "object" && value !== null && "bucket" in value;
}

// recharts' `DefaultTooltipContent` is declared without generics, so rendering the
// content ourselves is the only way to keep the chart's narrowed types. Markup and
// base styles mirror theirs.
export const StatsTooltip: (properties: TooltipContentProps<number, keyof BucketPoint>) => null | React.JSX.Element = ({
    contentStyle,
    itemStyle,
    label,
    labelFormatter,
    labelStyle,
    payload,
}) => {
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
                {METRIC_KEYS.map((metric) => {
                    return (
                        <li
                            className="recharts-tooltip-item"
                            key={metric}
                            style={{ display: "block", paddingBottom: 4, paddingTop: 4, ...itemStyle }}
                        >
                            <span className="recharts-tooltip-item-name">{METRICS[metric].label}</span>
                            <span className="recharts-tooltip-item-separator">{": "}</span>
                            <span className="recharts-tooltip-item-value">
                                {formatMetricValue(metric, bucketPoint[metric])}
                            </span>
                        </li>
                    );
                })}
            </ul>
        </div>
    );
};
