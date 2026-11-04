import { useQueryState } from "nuqs";

import { DASHBOARD_PARAMS } from "../lib/dashboard-params";
import { METRIC_KEYS, METRICS } from "../lib/metrics";
import type { StatsData } from "../lib/stats-buckets";
import { aggregate } from "../lib/stats-buckets";
import { StatsBarChart } from "./stats-bar-chart";

export const StatsChart: React.FC<StatsData> = ({ grid, rows }) => {
    const [selectedMetric, setSelectedMetric] = useQueryState("metric", DASHBOARD_PARAMS.metric);

    const points = aggregate(rows, grid);

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
            </div>

            {points.length === 0 ? (
                <p className="py-8 text-center text-gray-500">No data for selected range</p>
            ) : (
                <StatsBarChart grid={grid} points={points} selectedMetric={selectedMetric} />
            )}
        </div>
    );
};
