import type * as React from "react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Temporal } from "temporal-polyfill";

export interface StatsRow {
    bucket: string;
    country_code: null | string;
    connects: number;
    time_spent: number;
    bytes_sent: number;
}

export interface StatsData {
    rows: StatsRow[];
    from: Temporal.Instant;
    to: Temporal.Instant;
}

type Range = "1h" | "24h" | "30d" | "7d" | "all";

const RANGES: Array<{ label: string; value: Range }> = [
    { label: "Last hour", value: "1h" },
    { label: "Last 24 h", value: "24h" },
    { label: "Last 7 days", value: "7d" },
    { label: "Last 30 days", value: "30d" },
    { label: "All time", value: "all" },
];

const REFRESH_INTERVALS: Array<{ label: string; seconds: number }> = [
    { label: "10s", seconds: 10 },
    { label: "30s", seconds: 30 },
    { label: "1m", seconds: 60 },
    { label: "5m", seconds: 300 },
];

function rangeToParameters(range: Range): { from: string; to: string } {
    const now = Temporal.Now.instant();
    const to = now.toString();

    const msMap: Record<Range, number> = {
        "1h": 60 * 60 * 1000,
        "24h": 24 * 60 * 60 * 1000,
        "7d": 7 * 24 * 60 * 60 * 1000,
        "30d": 30 * 24 * 60 * 60 * 1000,
        // now it's 1 year, we'll figure out a better way
        all: 365 * 24 * 60 * 60 * 1000,
    };

    const from = now.subtract({ milliseconds: msMap[range] });

    return { from: from.toString(), to };
}

async function fetchStats(range: Range, onData: (data: StatsData) => void, signal: AbortSignal): Promise<void> {
    const { from, to } = rangeToParameters(range);

    const response = await fetch(`/api/stats?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, {
        signal,
    });

    if (!response.ok) {
        return;
    }

    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- data from trusted backend
    const rows = (await response.json()) as StatsRow[];

    onData({ rows, from: Temporal.Instant.from(from), to: Temporal.Instant.from(to) });
}

interface Properties {
    onData: (data: StatsData) => void;
}

export const TimeRangeSelector: React.FC<Properties> = ({ onData }) => {
    const [selected, setSelected] = useState<Range>("24h");
    const [isLoading, setIsLoading] = useState(true);
    const [refreshSeconds, setRefreshSeconds] = useState<null | number>(null);
    const [isRefreshing, setIsRefreshing] = useState(false);

    const abortReference = useRef<AbortController | null>(null);
    const intervalReference = useRef<null | ReturnType<typeof setInterval>>(null);
    const autoRefreshId = useId();

    const doFetch = useCallback(
        async (range: Range) => {
            abortReference.current?.abort();

            const controller = new AbortController();
            abortReference.current = controller;

            try {
                await fetchStats(range, onData, controller.signal);
            } catch (error) {
                if (!(error instanceof DOMException && error.name === "AbortError")) {
                    throw error;
                }
            } finally {
                // only the newest fetch owns the loading state
                if (abortReference.current === controller) {
                    setIsLoading(false);
                }
            }
        },
        [onData],
    );

    useEffect(() => {
        void doFetch(selected);
    }, [doFetch, selected]);

    const stopIntervalTimer = useCallback(() => {
        if (intervalReference.current === null) {
            return;
        }

        clearInterval(intervalReference.current);
        intervalReference.current = null;
    }, []);

    const startIntervalTimer = useCallback(() => {
        stopIntervalTimer();

        if (refreshSeconds === null) {
            return;
        }

        intervalReference.current = setInterval(() => {
            void doFetch(selected);
        }, refreshSeconds * 1000);
    }, [doFetch, refreshSeconds, selected, stopIntervalTimer]);

    useEffect(() => {
        startIntervalTimer();

        return stopIntervalTimer;
    }, [startIntervalTimer, stopIntervalTimer]);

    const handleChange = useCallback(
        (range: Range) => {
            if (range === selected) {
                return;
            }

            setSelected(range);
            setIsLoading(true);
        },
        [selected],
    );

    const refresh = useCallback(async () => {
        setIsRefreshing(true);

        // re-anchor the auto-refresh countdown to this fetch
        startIntervalTimer();

        try {
            await doFetch(selected);
        } finally {
            setIsRefreshing(false);
        }
    }, [doFetch, selected, startIntervalTimer]);

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
                        className={`rounded-sm px-3 py-1 text-sm transition-colors ${
                            selected === r.value
                                ? "bg-blue-600 text-white"
                                : "bg-gray-700 text-gray-300 hover:bg-gray-600"
                        }`}
                    >
                        {r.label}
                    </button>
                );
            })}
            <button
                type="button"
                onClick={() => {
                    void refresh();
                }}
                disabled={isRefreshing}
                title="Refresh"
                aria-label="Refresh"
                className="ml-2 rounded-sm bg-gray-700 px-3 py-1 text-sm text-gray-300 transition-colors hover:bg-gray-600"
            >
                <span aria-hidden="true" className={`inline-block ${isRefreshing ? "animate-spin" : ""}`}>
                    ↻
                </span>
            </button>
            <label className="text-sm text-gray-400" htmlFor={autoRefreshId}>
                Auto-refresh:
            </label>
            <select
                id={autoRefreshId}
                value={refreshSeconds ?? "off"}
                onChange={(event) => {
                    setRefreshSeconds(event.target.value === "off" ? null : Number(event.target.value));
                }}
                className="rounded-sm bg-gray-700 px-2 py-1 text-sm text-gray-300"
            >
                <option value="off">Off</option>
                {REFRESH_INTERVALS.map((interval) => {
                    return (
                        <option key={interval.seconds} value={interval.seconds}>
                            {interval.label}
                        </option>
                    );
                })}
            </select>
            {isLoading && <span className="ml-2 text-xs text-gray-500">Loading...</span>}
        </div>
    );
};
