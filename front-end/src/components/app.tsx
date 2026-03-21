import type React from "react";
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

export const App: React.FC = () => {
    const [activeConnections, setActiveConnections] = useState<ActiveConnection[]>([]);
    const [events, setEvents] = useState<DisconnectedEvent[]>([]);
    const [totalConnections, setTotalConnections] = useState(0);
    const [totalBytes, setTotalBytes] = useState(0);
    const [totalTimeSecs, setTotalTimeSecs] = useState(0);
    const [statsData, setStatsData] = useState<null | StatsData>(null);

    const seenSeqReference = useRef<Set<number>>(new Set());
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
            <header className="mb-6">
                <h1 className="text-2xl font-bold text-red-500">endless-ssh-rs honeypot</h1>
                <p className="text-sm text-gray-500">Live attack map</p>
            </header>

            <div className="space-y-6">
                <StatsPanel
                    totalConnections={totalConnections}
                    totalByteSent={totalBytes}
                    totalTimeWastedSecs={totalTimeSecs}
                    activeCount={activeConnections.length}
                />

                <WorldMap activeConnections={activeConnections} />

                <TimeRangeSelector onData={setStatsData} />

                {statsData !== null && <StatsChart rows={statsData.rows} from={statsData.from} to={statsData.to} />}

                <div>
                    <h2 className="mb-2 text-lg font-semibold text-gray-300">Recent disconnections</h2>
                    <EventFeed events={events} />
                </div>
            </div>
        </div>
    );
};
