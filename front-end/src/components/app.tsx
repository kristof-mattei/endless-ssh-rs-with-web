import type * as React from "react";
import { useReducer, useState } from "react";

import { useWebSocket } from "../hooks/use-web-sockets";
import { INITIAL_WS_STATE, wsReducer } from "../lib/ws-state";

import { EventFeed } from "./event-feed";
import { StatsChart } from "./stats-chart";
import { StatsPanel } from "./stats-panel";
import { TimeRangeSelector } from "./time-range-selector";
import type { StatsData } from "./time-range-selector";
import { WorldMap } from "./world-map";

function getTimezone(): string {
    const now: Temporal.ZonedDateTime = Temporal.Now.zonedDateTimeISO();

    // signHH:MM as a string offset (e.g., -07:00)
    const offset = now.offset;

    const format = new Intl.DateTimeFormat("en-US", {
        timeZone: now.timeZoneId,
        timeZoneName: "long",
    });
    const parts = format.formatToParts();

    // long-form descriptive name
    const timeZoneName = parts.find((p) => {
        return p.type === "timeZoneName";
    });

    if (timeZoneName === undefined) {
        return `GMT ${offset}`;
    }

    return `${timeZoneName.value}, GMT ${offset}`;
}

export const App: React.FC = () => {
    const [{ activeConnections, events, totalBytes, totalConnections, totalTimeSeconds }, dispatch] = useReducer(
        wsReducer,
        INITIAL_WS_STATE,
    );
    const [statsData, setStatsData] = useState<null | StatsData>(null);

    useWebSocket({ onEvent: dispatch });

    return (
        <div className="min-h-screen bg-gray-950 p-4 text-white">
            <header>
                <h1 className="text-2xl font-bold">endless-ssh-rs, an ssh honeypot</h1>
            </header>

            <section className="space-y-2 mb-6">
                <h2 className="text-lg font-semibold text-gray-300">Live attack map</h2>

                <StatsPanel
                    totalConnections={totalConnections}
                    totalBytesSent={totalBytes}
                    totalSecondsWasted={totalTimeSeconds}
                    activeConnectionsCount={activeConnections.length}
                />

                <WorldMap activeConnections={activeConnections} />
            </section>

            <section className="space-y-2 mb-6">
                <h2 className="text-lg font-semibold text-gray-300">Stats</h2>

                <TimeRangeSelector onData={setStatsData} />

                {statsData !== null && <StatsChart rows={statsData.rows} from={statsData.from} to={statsData.to} />}
            </section>

            <section>
                <h2 className="mb-2 text-lg font-semibold text-gray-300">
                    Recent disconnections (times in {getTimezone()})
                </h2>
                <EventFeed events={events} />
            </section>
        </div>
    );
};
