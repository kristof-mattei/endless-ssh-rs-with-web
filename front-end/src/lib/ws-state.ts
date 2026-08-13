import { Temporal } from "temporal-polyfill";

import type { ActiveConnectionInfo } from "../generated/ActiveConnectionInfo";
import type { WsEvent } from "../generated/WsEvent";
import type { DisconnectedEvent } from "../hooks/use-web-sockets";

const MAX_EVENTS = 100;

export interface WsState {
    activeConnections: ActiveConnectionInfo[];
    events: DisconnectedEvent[];
    lastCountedId: number;
    maxSeenSequence: number;
    totalBytes: number;
    totalConnections: number;
    totalTimeSeconds: number;
}

export const INITIAL_WS_STATE: WsState = {
    activeConnections: [],
    events: [],
    lastCountedId: 0,
    maxSeenSequence: 0,
    totalBytes: 0,
    totalConnections: 0,
    totalTimeSeconds: 0,
};

function isSameConnection(active: ActiveConnectionInfo, event: DisconnectedEvent): boolean {
    if (active.ip !== event.ip || active.port !== event.port) {
        return false;
    }

    // a disconnect dated before this entry connected belongs to an earlier connection on the same ip and port
    return Temporal.Instant.compare(active.connected_at, event.disconnected_at) < 0;
}

export function wsReducer(state: WsState, event: WsEvent): WsState {
    switch (event.type) {
        case "init": {
            return {
                ...state,
                activeConnections: event.active_connections,
                lastCountedId: event.last_counted_id,
                totalBytes: event.total_bytes_sent,
                totalConnections: event.total_connections,
                totalTimeSeconds: event.total_time_spent,
            };
        }
        case "ready": {
            // the server's replay-done marker, nothing to update
            return state;
        }
        case "connected": {
            const isKnown = state.activeConnections.some((c) => {
                return c.ip === event.ip && c.port === event.port;
            });

            if (isKnown) {
                return state;
            }

            return {
                ...state,
                activeConnections: [
                    ...state.activeConnections,
                    {
                        ip: event.ip,
                        port: event.port,
                        connected_at: event.connected_at,
                        bytes_sent: 0,
                        latitude: event.latitude,
                        longitude: event.longitude,
                        country_code: event.country_code,
                        country_name: event.country_name,
                        city: event.city,
                    },
                ],
            };
        }
        case "bytes_sent": {
            return {
                ...state,
                activeConnections: state.activeConnections.map((c) => {
                    return c.ip === event.ip && c.port === event.port ? { ...c, bytes_sent: event.bytes_sent } : c;
                }),
            };
        }
        case "disconnected": {
            // the sequence is monotonic and delivery is in-order, so anything at
            // or below the high-water mark is a replay duplicate
            if (event.sequence <= state.maxSeenSequence) {
                return state;
            }

            const next: WsState = {
                ...state,
                activeConnections: state.activeConnections.filter((c) => {
                    return !isSameConnection(c, event);
                }),
                events: [...state.events, event].slice(-MAX_EVENTS),
                maxSeenSequence: event.sequence,
            };

            // at or below the last counted id the record is already inside init's totals
            if (event.sequence <= state.lastCountedId) {
                return next;
            }

            return {
                ...next,
                totalBytes: next.totalBytes + event.bytes_sent,
                totalConnections: next.totalConnections + 1,
                totalTimeSeconds: next.totalTimeSeconds + event.time_spent,
            };
        }
    }
}
