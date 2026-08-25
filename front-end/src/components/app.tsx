/* oxlint-disable import/max-dependencies -- App renders every dashboard section */
import type React from "react";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";

import { useEventSource } from "../hooks/use-event-source";
import { INITIAL_WS_STATE, wsReducer } from "../lib/ws-state";
import { ActiveConnections } from "./active-connections";
import { ConnectionBadge } from "./connection-badge";
import { EventFeed } from "./event-feed";
import { StatsChart } from "./stats-chart";
import { StatsPanel } from "./stats-panel";
import { TimeRangeSelector } from "./time-range-selector";
import type { StatsData } from "./time-range-selector";
import { TopCountries } from "./top-countries";
import { WorldMap } from "./world-map";

export const App: React.FC = () => {
    const [{ activeConnections, events, maxSeenSequence, totalBytes, totalConnections, totalTimeSeconds }, dispatch] =
        useReducer(wsReducer, INITIAL_WS_STATE);
    const [statsData, setStatsData] = useState<null | StatsData>(null);

    // the reducer owns delivery progress, the hook reads it through this ref when building the reconnect URL
    const maxSeenSequenceReference = useRef(0);

    useEffect(() => {
        maxSeenSequenceReference.current = maxSeenSequence;
    }, [maxSeenSequence]);

    const getSince = useCallback(() => {
        return maxSeenSequenceReference.current;
    }, []);

    const { status } = useEventSource({ getSince, onEvent: dispatch });

    return (
        <div className="bg-gray-950 p-4 text-white min-block-screen">
            <header>
                <h1 className="text-2xl font-bold">endless-ssh-rs, an ssh honeypot</h1>
            </header>

            <section className="mbe-6 space-y-2">
                <div className="flex items-center gap-2">
                    <h2 className="text-lg font-semibold text-gray-300">Live attack map</h2>
                    <ConnectionBadge status={status} />
                </div>

                <StatsPanel
                    activeConnectionsCount={activeConnections.length}
                    totalBytesSent={totalBytes}
                    totalConnections={totalConnections}
                    totalSecondsWasted={totalTimeSeconds}
                />

                <div className="grid gap-3 lg:grid-cols-4">
                    <div className="lg:col-span-3">
                        <WorldMap activeConnections={activeConnections} />
                    </div>
                    <ActiveConnections activeConnections={activeConnections} />
                </div>
            </section>

            <section className="mbe-6 space-y-2">
                <h2 className="text-lg font-semibold text-gray-300">Stats</h2>

                <TimeRangeSelector isLive={status === "live"} onData={setStatsData} />

                {statsData !== null && (
                    <div className="grid gap-3 lg:grid-cols-4">
                        <div className="lg:col-span-3">
                            <StatsChart
                                bucketMs={statsData.bucketMs}
                                from={statsData.from}
                                rows={statsData.rows}
                                to={statsData.to}
                            />
                        </div>
                        <TopCountries rows={statsData.rows} />
                    </div>
                )}
            </section>

            <section>
                <EventFeed events={events} />
            </section>
        </div>
    );
};
