import type React from "react";
import { useCallback, useRef, useState } from "react";

import { EventFeed } from "@/components/event-feed.tsx";
import { StatsPanel } from "@/components/stats-panel.tsx";
import { TimeRangeSelector } from "@/components/time-range-selector.tsx";
import type { StatsRow } from "@/components/time-range-selector.tsx";
import { WorldMap } from "@/components/world-map.tsx";
import type { ActiveConnection, DisconnectedEvent, WsEvent } from "@/hooks/use-web-sockets.ts";
import { useWebSocket } from "@/hooks/use-web-sockets.ts";

const MAX_EVENTS = 100;

export const App: React.FC = () => {
    const [activeConnections, setActiveConnections] = useState<ActiveConnection[]>([]);
    const [events, setEvents] = useState<DisconnectedEvent[]>([]);
    const [totalConnections, setTotalConnections] = useState(0);
    const [totalBytes, setTotalBytes] = useState(0);
    const [totalTimeSecs, setTotalTimeSecs] = useState(0);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const [_statsRows, setStatsRows] = useState<StatsRow[]>([]);

    const seenSeqReference = useRef<Set<number>>(new Set());

    const handleEvent = useCallback((wsEvent: WsEvent) => {
        switch (wsEvent.type) {
            case "init": {
                setActiveConnections(wsEvent.active_connections);
                break;
            }
            case "ready": {
                // history replay done, no action needed
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
                    const next = [...previous, wsEvent];
                    return next.length > MAX_EVENTS ? next.slice(next.length - MAX_EVENTS) : next;
                });

                setTotalConnections((n) => {
                    return n + 1;
                });

                setTotalBytes((n) => {
                    return n + wsEvent.bytes_sent;
                });

                setTotalTimeSecs((n) => {
                    // TODO fix: right now `time_spent` is an array of [seconds, nanoseconds]
                    return n + wsEvent.time_spent;
                });

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

                <TimeRangeSelector onData={setStatsRows} />

                <div>
                    <h2 className="mb-2 text-lg font-semibold text-gray-300">Recent disconnections</h2>
                    <EventFeed events={events} />
                </div>
            </div>
        </div>
    );
};
