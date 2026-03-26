import type * as React from "react";
import { useCallback, useRef, useState } from "react";

import type { ActiveConnection, DisconnectedEvent, WsEvent } from "../hooks/use-web-sockets";

import { useWebSocket } from "../hooks/use-web-sockets";

import { EventFeed } from "./event-feed";
import { StatsChart } from "./stats-chart";
import { StatsPanel } from "./stats-panel";
import { TimeRangeSelector } from "./time-range-selector";
import type { StatsData } from "./time-range-selector";
import { WorldMap } from "./world-map";

const MAX_EVENTS = 100;

function getTimezone(): string {
    const now: Temporal.ZonedDateTime = Temporal.Now.zonedDateTimeISO();

    // signHH:MM as a string offset (e.g., -07:00)
    const offset = now.offset;

    const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: now.timeZoneId,
        timeZoneName: "long",
    }).formatToParts();

    // long-form descriptive name
    const timeZoneName = parts.find((p) => {
        return p.type === "timeZoneName";
    });

    if (timeZoneName === undefined) {
        return `GMT ${offset}`;
    } else {
        return `${timeZoneName.value}, GMT ${offset}`;
    }
}

export const App: React.FC = () => {
    const [activeConnections, setActiveConnections] = useState<ActiveConnection[]>([]);
    const [events, setEvents] = useState<DisconnectedEvent[]>([]);
    const [totalConnections, setTotalConnections] = useState(0);
    const [totalBytes, setTotalBytes] = useState(0);
    const [totalTimeSecs, setTotalTimeSecs] = useState(0);
    const [statsData, setStatsData] = useState<null | StatsData>(null);

    const seenSeqReference = useRef(new Set());
    const isLiveReference = useRef(false);

    const handleEvent = useCallback((wsEvent: WsEvent) => {
        switch (wsEvent.type) {
            case "init": {
                isLiveReference.current = false;
                setActiveConnections(wsEvent.active_connections);
                setTotalConnections(wsEvent.total_connections);
                setTotalBytes(wsEvent.total_bytes_sent);
                setTotalTimeSecs(wsEvent.total_time_spent);
                break;
            }
            case "ready": {
                isLiveReference.current = true;
                break;
            }
            case "connected": {
                setActiveConnections((previous) => {
                    const exists = previous.some((c) => {
                        return c.ip === wsEvent.ip;
                    });

                    if (exists) {
                        return previous;
                    }

                    return [
                        ...previous,
                        {
                            ip: wsEvent.ip,
                            connected_at: wsEvent.connected_at,
                            lat: wsEvent.lat,
                            lon: wsEvent.lon,
                            country_code: null,
                        },
                    ];
                });
                break;
            }
            case "disconnected": {
                // deduplicate across history replay + live stream
                if (seenSeqReference.current.has(wsEvent.seq)) {
                    break;
                }
                seenSeqReference.current.add(wsEvent.seq);

                setActiveConnections((previous) => {
                    return previous.filter((c) => {
                        return c.ip !== wsEvent.ip;
                    });
                });

                setEvents((previous) => {
                    if (previous.length >= MAX_EVENTS) {
                        // +1 because we're making space for our new event
                        return [...previous.slice(previous.length - MAX_EVENTS + 1), wsEvent];
                    }

                    return [...previous, wsEvent];
                });

                if (isLiveReference.current) {
                    setTotalConnections((n) => {
                        return n + 1;
                    });

                    setTotalBytes((n) => {
                        return n + wsEvent.bytes_sent;
                    });

                    setTotalTimeSecs((n) => {
                        return n + wsEvent.time_spent;
                    });
                }

                break;
            }
        }
    }, []);

    useWebSocket({ onEvent: handleEvent });

    return (
        <div className="min-h-screen bg-gray-950 p-4 text-white">
            <header>
                <h1 className="text-2xl font-bold">endless-ssh-rs, an ssh honeypot</h1>
            </header>

            <section className="space-y-2 mb-6">
                <h2 className="text-lg font-semibold text-gray-300">Live attack map</h2>

                <StatsPanel
                    totalConnections={totalConnections}
                    totalByteSent={totalBytes}
                    totalTimeWastedSecs={totalTimeSecs}
                    activeCount={activeConnections.length}
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
