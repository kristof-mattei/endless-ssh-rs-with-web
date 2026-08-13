import type * as React from "react";
import { useReducer, useState } from "react";
import { Temporal } from "temporal-polyfill";

import type { WsEvent } from "../generated/WsEvent";
import type { ConnectionStatus } from "../hooks/use-web-sockets";
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

    const format = new Intl.DateTimeFormat([], {
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

const TIMEZONE = getTimezone();

type EventSourceStatus = "demo" | ConnectionStatus;

const CONNECTION_STATUS_STYLES: Record<EventSourceStatus, { dot: string; text: string }> = {
    connecting: { dot: "bg-gray-500", text: "text-gray-400" },
    demo: { dot: "bg-purple-500", text: "text-purple-400" },
    live: { dot: "bg-green-500", text: "text-green-400" },
    reconnecting: { dot: "bg-amber-500", text: "text-amber-400" },
};

const ConnectionBadge: React.FC<{ status: EventSourceStatus }> = ({ status }) => {
    const { dot, text } = CONNECTION_STATUS_STYLES[status];

    return (
        <span className={`flex items-center gap-1.5 text-sm ${text}`}>
            <span aria-hidden="true" className={`size-2 rounded-full ${dot}`} />
            {status}
        </span>
    );
};

interface Properties {
    useEventSource: (options: { onEvent: (event: WsEvent) => void }) => { status: EventSourceStatus };
}

export const App: React.FC<Properties> = ({ useEventSource }) => {
    const [{ activeConnections, events, totalBytes, totalConnections, totalTimeSeconds }, dispatch] = useReducer(
        wsReducer,
        INITIAL_WS_STATE,
    );
    const [statsData, setStatsData] = useState<null | StatsData>(null);

    const { status } = useEventSource({ onEvent: dispatch });

    return (
        <div className="min-h-screen bg-gray-950 p-4 text-white">
            <header>
                <h1 className="text-2xl font-bold">endless-ssh-rs, an ssh honeypot</h1>
            </header>

            <section className="mb-6 space-y-2">
                <div className="flex items-center gap-2">
                    <h2 className="text-lg font-semibold text-gray-300">Live attack map</h2>
                    <ConnectionBadge status={status} />
                </div>

                <StatsPanel
                    totalConnections={totalConnections}
                    totalBytesSent={totalBytes}
                    totalSecondsWasted={totalTimeSeconds}
                    activeConnectionsCount={activeConnections.length}
                />

                <WorldMap activeConnections={activeConnections} />
            </section>

            <section className="mb-6 space-y-2">
                <h2 className="text-lg font-semibold text-gray-300">Stats</h2>

                <TimeRangeSelector onData={setStatsData} />

                {statsData !== null && <StatsChart rows={statsData.rows} from={statsData.from} to={statsData.to} />}
            </section>

            <section>
                <h2 className="mb-2 text-lg font-semibold text-gray-300">
                    Recent disconnections (times in {TIMEZONE})
                </h2>
                <EventFeed events={events} />
            </section>
        </div>
    );
};
