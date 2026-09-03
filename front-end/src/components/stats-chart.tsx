import { useQueryState } from "nuqs";
import { useId, useState } from "react";

import { DASHBOARD_PARAMS } from "../lib/dashboard-params";
import { METRIC_KEYS, METRICS } from "../lib/metrics";
import type { StatsData } from "../lib/stats-buckets";
import { aggregate } from "../lib/stats-buckets";
import { RechartsStatsChart } from "./stats-chart-recharts";
import { UnovisStatsChart } from "./stats-chart-unovis";

// both libraries draw the same points, the radio picks which one does
const CHART_LIBRARIES = ["recharts", "unovis"] as const;

type ChartLibrary = (typeof CHART_LIBRARIES)[number];

export const StatsChart: React.FC<StatsData> = ({ grid, rows }) => {
    const [selectedMetric, setSelectedMetric] = useQueryState("metric", DASHBOARD_PARAMS.metric);
    const [library, setLibrary] = useState<ChartLibrary>("recharts");
    const libraryGroup = useId();

    const points = aggregate(rows, grid);

    const Chart = library === "recharts" ? RechartsStatsChart : UnovisStatsChart;

    return (
        <div className="rounded-lg bg-gray-800 p-4">
            <div className="mbe-3 flex items-center gap-2">
                {METRIC_KEYS.map((metric) => {
                    return (
                        <button
                            aria-pressed={selectedMetric === metric}
                            className={`rounded-sm px-3 py-1 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 ${
                                selectedMetric === metric
                                    ? "bg-blue-600 text-white"
                                    : "bg-gray-700 text-gray-300 hover:bg-gray-600"
                            }`}
                            key={metric}
                            onClick={() => {
                                void setSelectedMetric(metric);
                            }}
                            type="button"
                        >
                            {METRICS[metric].label}
                        </button>
                    );
                })}
                <fieldset className="ms-auto flex items-center gap-3 text-sm text-gray-300">
                    <legend className="sr-only">Chart library</legend>
                    {CHART_LIBRARIES.map((candidate) => {
                        return (
                            <label className="flex items-center gap-1" key={candidate}>
                                <input
                                    checked={library === candidate}
                                    className="accent-blue-600"
                                    name={libraryGroup}
                                    onChange={() => {
                                        setLibrary(candidate);
                                    }}
                                    type="radio"
                                    value={candidate}
                                />
                                {candidate}
                            </label>
                        );
                    })}
                </fieldset>
            </div>

            {points.length === 0 ? (
                <p className="py-8 text-center text-gray-500">No data for selected range</p>
            ) : (
                <Chart grid={grid} points={points} selectedMetric={selectedMetric} />
            )}
        </div>
    );
};
