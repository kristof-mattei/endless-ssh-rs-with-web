import { useQueryState } from "nuqs";
import type React from "react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Temporal } from "temporal-polyfill";

import type { StatsRow } from "../generated/StatsRow";
import type { Range } from "../lib/dashboard-params";
import { DASHBOARD_PARAMS, RANGE_SLUGS, RANGES, REFRESH_INTERVALS, REFRESH_SLUGS } from "../lib/dashboard-params";
import type { InstantRange, StatsData } from "../lib/stats-buckets";
import { parseStatsResponse } from "../lib/wire";

function windowToRange(window: Temporal.DurationLike): InstantRange {
    const to = Temporal.Now.instant();

    return { from: to.subtract(window), to };
}

// rows are ordered by bucket, so an open-ended range starts at the first row, or collapses to `to` without rows
function openEndedFrom(rows: StatsRow[], to: Temporal.Instant): Temporal.Instant {
    return rows.at(0)?.bucket ?? to;
}

async function fetchStats(range: Range, onData: (data: StatsData) => void, signal: AbortSignal): Promise<void> {
    const { window } = RANGES[range];
    const requested = window === null ? null : windowToRange(window);

    const url =
        requested === null
            ? "/api/stats"
            : `/api/stats?from=${encodeURIComponent(requested.from.toString())}&to=${encodeURIComponent(requested.to.toString())}`;

    const response = await fetch(url, { signal });

    if (!response.ok) {
        throw new Error(`stats fetch failed with ${String(response.status)}`);
    }

    const data = parseStatsResponse(await response.text());

    const to = requested?.to ?? Temporal.Now.instant();
    const from = requested?.from ?? openEndedFrom(data.rows, to);

    onData({
        grid: { bucketWidthMs: data.bucket_seconds * 1000, range: { from, to } },
        rows: data.rows,
    });
}

interface Properties {
    isLive: boolean;
    onData: (data: StatsData) => void;
}

export const TimeRangeSelector: React.FC<Properties> = ({ isLive, onData }) => {
    const [selected, setSelected] = useQueryState("range", DASHBOARD_PARAMS.range);
    const [refreshLabel, setRefreshLabel] = useQueryState("refresh", DASHBOARD_PARAMS.refresh);
    const [isLoading, setIsLoading] = useState(true);
    const [hasError, setHasError] = useState(false);
    const [isRefreshing, setIsRefreshing] = useState(false);

    const { interval: refreshInterval } = REFRESH_INTERVALS[refreshLabel];

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
        // oxlint-disable-next-line react/set-state-in-effect -- this effect is the range-change handler, the range arrives from the URL so back and forward reach it the same way a click does
        setIsLoading(true);
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

        if (refreshInterval === null) {
            return;
        }

        intervalReference.current = setInterval(() => {
            void doFetch(selected);
        }, Temporal.Duration.from(refreshInterval).total("milliseconds"));
    }, [doFetch, refreshInterval, selected, stopIntervalTimer]);

    useEffect(() => {
        startIntervalTimer();

        return stopIntervalTimer;
    }, [startIntervalTimer, stopIntervalTimer]);

    // re-selecting the current range would otherwise push a history entry whose back step is a no-op
    const handleChange = useCallback(
        (range: Range) => {
            if (range === selected) {
                return;
            }

            void setSelected(range);
        },
        [selected, setSelected],
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
            {RANGE_SLUGS.map((range) => {
                return (
                    <button
                        aria-pressed={selected === range}
                        className={`rounded-sm px-3 py-1 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 ${
                            selected === range
                                ? "bg-blue-600 text-white"
                                : "bg-gray-700 text-gray-300 hover:bg-gray-600"
                        }`}
                        key={range}
                        onClick={() => {
                            handleChange(range);
                        }}
                        type="button"
                    >
                        {RANGES[range].label}
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
                    const chosen = DASHBOARD_PARAMS.refresh.parse(event.target.value);

                    if (chosen === null) {
                        return;
                    }

                    void setRefreshLabel(chosen);
                }}
                value={refreshLabel}
            >
                {REFRESH_SLUGS.map((slug) => {
                    return (
                        <option key={slug} value={slug}>
                            {REFRESH_INTERVALS[slug].label}
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
