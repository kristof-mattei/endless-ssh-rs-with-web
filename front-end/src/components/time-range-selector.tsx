import type React from "react";
import { useCallback, useState } from "react";

export interface StatsRow {
    bucket: string;
    country_code: null | string;
    connects: number;
    time_spent: number;
    bytes_sent: number;
}

type Range = "1h" | "24h" | "30d" | "7d" | "all";

const RANGES: { label: string; value: Range }[] = [
    { label: "Last hour", value: "1h" },
    { label: "Last 24 h", value: "24h" },
    { label: "Last 7 days", value: "7d" },
    { label: "Last 30 days", value: "30d" },
    { label: "All time", value: "all" },
];

function rangeToParameters(range: Range): { from: string; to: string } {
    const now = new Date();
    const to = now.toISOString();
    const msMap: Record<Range, number> = {
        "1h": 60 * 60 * 1000,
        "24h": 24 * 60 * 60 * 1000,
        "7d": 7 * 24 * 60 * 60 * 1000,
        "30d": 30 * 24 * 60 * 60 * 1000,
        all: 365 * 24 * 60 * 60 * 1000 * 10,
    };

    const from = new Date(now.getTime() - msMap[range]).toISOString();

    return { from, to };
}

interface Properties {
    onData: (rows: StatsRow[]) => void;
}

export const TimeRangeSelector: React.FC<Properties> = ({ onData }) => {
    const [selected, setSelected] = useState<Range>("24h");
    const [loading, setLoading] = useState(false);

    const fetchStats = useCallback(
        async (range: Range) => {
            setLoading(true);
            try {
                const { from, to } = rangeToParameters(range);
                const response = await fetch(
                    `/api/stats?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
                );
                if (response.ok) {
                    const rows = (await response.json()) as StatsRow[];
                    onData(rows);
                }
            } finally {
                setLoading(false);
            }
        },
        [onData],
    );

    const handleChange = useCallback(
        (range: Range) => {
            setSelected(range);
            void fetchStats(range);
        },
        [fetchStats],
    );

    return (
        <div className="flex items-center gap-2">
            <span className="text-sm text-gray-400">Time range:</span>
            {RANGES.map((r) => {
                return (
                    <button
                        key={r.value}
                        type="button"
                        onClick={() => {
                            handleChange(r.value);
                        }}
                        disabled={loading}
                        className={`rounded px-3 py-1 text-sm transition-colors ${
                            selected === r.value
                                ? "bg-blue-600 text-white"
                                : "bg-gray-700 text-gray-300 hover:bg-gray-600"
                        }`}
                    >
                        {r.label}
                    </button>
                );
            })}
            {loading && <span className="ml-2 text-xs text-gray-500">Loading...</span>}
        </div>
    );
};
