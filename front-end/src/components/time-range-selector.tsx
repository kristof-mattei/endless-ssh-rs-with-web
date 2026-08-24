import type React from "react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Temporal } from "temporal-polyfill";

import type { StatsResponse } from "../generated/StatsResponse";
import type { StatsRow } from "../generated/StatsRow";

export interface StatsData {
    bucketMs: number;
    from: Temporal.Instant;
    rows: StatsRow[];
    to: Temporal.Instant;
}

type Range = "1h" | "24h" | "30d" | "7d" | "all";

const RANGES: { label: string; value: Range }[] = [
    { label: "Last hour", value: "1h" },
    { label: "Last 24 h", value: "24h" },
    { label: "Last 7 days", value: "7d" },
    { label: "Last 30 days", value: "30d" },
    { label: "All time", value: "all" },
];

const REFRESH_INTERVALS: { label: string; seconds: number }[] = [
    { label: "10s", seconds: 10 },
    { label: "30s", seconds: 30 },
    { label: "1m", seconds: 60 },
    { label: "5m", seconds: 300 },
];

function rangeToParameters(range: Exclude<Range, "all">): { from: string; to: string } {
    const now = Temporal.Now.instant();
    const to = now.toString();

    const msMap: Record<Exclude<Range, "all">, number> = {
        "1h": 60 * 60 * 1000,
        "24h": 24 * 60 * 60 * 1000,
        "7d": 7 * 24 * 60 * 60 * 1000,
        "30d": 30 * 24 * 60 * 60 * 1000,
    };

    const from = now.subtract({ milliseconds: msMap[range] });

    return { from: from.toString(), to };
}

// rows are ordered by bucket, so an open-ended range starts at the first row, or collapses to `to` without rows
function openEndedFrom(rows: StatsRow[], to: Temporal.Instant): Temporal.Instant {
    const first = rows.at(0);

    return first === undefined ? to : Temporal.Instant.from(first.bucket);
}

async function fetchStats(range: Range, onData: (data: StatsData) => void, signal: AbortSignal): Promise<void> {
    // "all" is the no-parameter query, open-ended on both sides
    const parameters = range === "all" ? null : rangeToParameters(range);

    const url =
        parameters === null
            ? "/api/stats"
            : `/api/stats?from=${encodeURIComponent(parameters.from)}&to=${encodeURIComponent(parameters.to)}`;

    const response = await fetch(url, { signal });

    if (!response.ok) {
        throw new Error(`stats fetch failed with ${String(response.status)}`);
    }

    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- data from trusted backend
    const data = (await response.json()) as StatsResponse;

    const to = parameters === null ? Temporal.Now.instant() : Temporal.Instant.from(parameters.to);
    const from = parameters === null ? openEndedFrom(data.rows, to) : Temporal.Instant.from(parameters.from);

    onData({
        rows: data.rows,
        bucketMs: data.bucket_seconds * 1000,
        from,
        to,
    });
}

interface Properties {
    isLive: boolean;
    onData: (data: StatsData) => void;
}

export const TimeRangeSelector: React.FC<Properties> = ({ isLive, onData }) => {
    const [selected, setSelected] = useState<Range>("24h");
    const [isLoading, setIsLoading] = useState(true);
    const [hasError, setHasError] = useState(false);
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
                // only the newest fetch owns the loading and error state
                if (abortReference.current === controller) {
                    setIsLoading(false);

                    if (!(error instanceof DOMException && error.name === "AbortError")) {
                        setHasError(true);
                    }
                }

                return;
            }

            // only the newest fetch owns the loading and error state
            if (abortReference.current === controller) {
                setIsLoading(false);
                setHasError(false);
            }
        },
        [onData],
    );

    useEffect(() => {
        // oxlint-disable-next-line react/set-state-in-effect -- doFetch only sets state after the fetch resolves, oxlint's port does not see the await boundary
        void doFetch(selected);
    }, [doFetch, selected]);

    // the range resolves to absolute instants at fetch time, so a fetch is stale after any
    // gap: refetch when the socket recovers and when the tab becomes visible again
    const wasLiveReference = useRef(isLive);

    useEffect(() => {
        if (isLive && !wasLiveReference.current) {
            void doFetch(selected);
        }

        wasLiveReference.current = isLive;
    }, [doFetch, isLive, selected]);

    useEffect(() => {
        const refetchWhenVisible = (): void => {
            if (document.visibilityState === "visible") {
                void doFetch(selected);
            }
        };

        document.addEventListener("visibilitychange", refetchWhenVisible);

        return (): void => {
            document.removeEventListener("visibilitychange", refetchWhenVisible);
        };
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

        // doFetch reports failures through the error state and never throws
        await doFetch(selected);

        setIsRefreshing(false);
    }, [doFetch, selected, startIntervalTimer]);

    return (
        <div className="flex items-center gap-2">
            <span className="text-sm text-gray-400">Time range:</span>
            {RANGES.map((range) => {
                return (
                    <button
                        aria-pressed={selected === range.value}
                        className={`rounded-sm px-3 py-1 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 ${
                            selected === range.value
                                ? "bg-blue-600 text-white"
                                : "bg-gray-700 text-gray-300 hover:bg-gray-600"
                        }`}
                        key={range.value}
                        onClick={() => {
                            handleChange(range.value);
                        }}
                        type="button"
                    >
                        {range.label}
                    </button>
                );
            })}
            <button
                aria-label="Refresh"
                className="ms-2 rounded-sm bg-gray-700 px-3 py-1 text-sm text-gray-300 transition-colors hover:bg-gray-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
                disabled={isRefreshing}
                onClick={() => {
                    void refresh();
                }}
                title="Refresh"
                type="button"
            >
                <span aria-hidden="true" className={`inline-block ${isRefreshing ? "animate-spin" : ""}`}>
                    ↻
                </span>
            </button>
            <label className="text-sm text-gray-400" htmlFor={autoRefreshId}>
                Auto-refresh:
            </label>
            <select
                className="rounded-sm bg-gray-700 px-2 py-1 text-sm text-gray-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
                id={autoRefreshId}
                onChange={(event) => {
                    setRefreshSeconds(event.target.value === "off" ? null : Number(event.target.value));
                }}
                value={refreshSeconds ?? "off"}
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
            {isLoading && <span className="ms-2 text-xs text-gray-500">Loading...</span>}
            {hasError && !isLoading && (
                <span className="ms-2 text-xs text-red-400">
                    Failed to load stats.{" "}
                    <button
                        className="underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
                        onClick={() => {
                            void refresh();
                        }}
                        type="button"
                    >
                        Retry
                    </button>
                </span>
            )}
        </div>
    );
};
