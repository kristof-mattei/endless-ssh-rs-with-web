import { describe, expect, it } from "vitest";

import type {
    ActiveConnection,
    ConnectedEvent,
    DisconnectedEvent,
    InitEvent,
    ReadyEvent,
    WsEvent,
} from "../hooks/use-web-sockets";

import type { WsState } from "./ws-state";

import { INITIAL_WS_STATE, wsReducer } from "./ws-state";

function init(overrides?: Partial<Omit<InitEvent, "type">>): InitEvent {
    return {
        type: "init",
        active_connections: [],
        total_connections: 0,
        total_bytes_sent: 0,
        total_time_spent: 0,
        last_counted_id: 0,
        ...overrides,
    };
}

const READY: ReadyEvent = { type: "ready" };

function connected(ip: string, port: number): ConnectedEvent {
    return {
        type: "connected",
        ip,
        port,
        connected_at: "2026-07-27T10:00:00Z",
        country_code: null,
        country_name: null,
        city: null,
        latitude: 51.2,
        longitude: 4.4,
    };
}

function disconnected(
    sequence: number,
    overrides?: Partial<Omit<DisconnectedEvent, "sequence" | "type">>,
): DisconnectedEvent {
    return {
        type: "disconnected",
        sequence,
        ip: `192.0.2.${sequence.toString()}`,
        port: 50_000,
        connected_at: "2026-07-27T10:00:00Z",
        disconnected_at: "2026-07-27T10:01:00Z",
        time_spent: 60,
        bytes_sent: 1000,
        country_code: null,
        country_name: null,
        city: null,
        latitude: null,
        longitude: null,
        ...overrides,
    };
}

function activeConnection(ip: string, overrides?: Partial<Omit<ActiveConnection, "ip">>): ActiveConnection {
    return {
        ip,
        port: 50_000,
        connected_at: "2026-07-27T09:00:00Z",
        latitude: null,
        longitude: null,
        country_code: null,
        country_name: null,
        city: null,
        ...overrides,
    };
}

function applyEvents(state: WsState, events: WsEvent[]): WsState {
    let current = state;

    for (const event of events) {
        current = wsReducer(current, event);
    }

    return current;
}

describe("wsReducer", () => {
    describe("init", () => {
        it("adopts the server's totals and active connections", () => {
            const state = applyEvents(INITIAL_WS_STATE, [
                init({
                    active_connections: [activeConnection("198.51.100.7")],
                    total_connections: 42,
                    total_bytes_sent: 1_000_000,
                    total_time_spent: 3600,
                }),
            ]);

            expect(state.totalConnections).toBe(42);
            expect(state.totalBytes).toBe(1_000_000);
            expect(state.totalTimeSeconds).toBe(3600);
            expect(state.activeConnections).toHaveLength(1);
        });
    });

    describe("ready", () => {
        it("leaves the state untouched", () => {
            const before = applyEvents(INITIAL_WS_STATE, [init()]);

            expect(wsReducer(before, READY)).toBe(before);
        });
    });

    describe("connected", () => {
        it("adds a new connection", () => {
            const state = applyEvents(INITIAL_WS_STATE, [init(), READY, connected("198.51.100.7", 50_000)]);

            expect(
                state.activeConnections.map((c) => {
                    return c.ip;
                }),
            ).toEqual(["198.51.100.7"]);
        });

        it("ignores a duplicate ip and port", () => {
            const before = applyEvents(INITIAL_WS_STATE, [init(), READY, connected("198.51.100.7", 50_000)]);
            const after = wsReducer(before, connected("198.51.100.7", 50_000));

            expect(after).toBe(before);
        });

        it("tracks simultaneous connections from the same ip on different ports", () => {
            const state = applyEvents(INITIAL_WS_STATE, [
                init(),
                READY,
                connected("198.51.100.7", 1111),
                connected("198.51.100.7", 2222),
            ]);

            expect(
                state.activeConnections.map((c) => {
                    return c.port;
                }),
            ).toEqual([1111, 2222]);
        });
    });

    describe("disconnected", () => {
        it("moves the connection from the map to the feed", () => {
            const state = applyEvents(INITIAL_WS_STATE, [
                init(),
                READY,
                connected("198.51.100.7", 50_000),
                connected("198.51.100.8", 50_000),
                disconnected(1, { ip: "198.51.100.7" }),
            ]);

            expect(
                state.activeConnections.map((c) => {
                    return c.ip;
                }),
            ).toEqual(["198.51.100.8"]);
            expect(
                state.events.map((event) => {
                    return event.sequence;
                }),
            ).toEqual([1]);
        });

        it("removes only the connection on the matching port", () => {
            const state = applyEvents(INITIAL_WS_STATE, [
                init(),
                READY,
                connected("198.51.100.7", 1111),
                connected("198.51.100.7", 2222),
                disconnected(1, { ip: "198.51.100.7", port: 1111 }),
            ]);

            expect(
                state.activeConnections.map((c) => {
                    return c.port;
                }),
            ).toEqual([2222]);
        });

        it("keeps a newer connection when a replayed disconnect matches a reused ip and port", () => {
            const state = applyEvents(INITIAL_WS_STATE, [
                init({
                    active_connections: [
                        activeConnection("198.51.100.7", { port: 1111, connected_at: "2026-07-27T11:00:00Z" }),
                    ],
                }),
                disconnected(1, { ip: "198.51.100.7", port: 1111, disconnected_at: "2026-07-27T10:30:00Z" }),
                READY,
            ]);

            expect(state.activeConnections).toHaveLength(1);
            expect(
                state.events.map((event) => {
                    return event.sequence;
                }),
            ).toEqual([1]);
        });

        it("matches IPv6 connections by exact string", () => {
            const state = applyEvents(INITIAL_WS_STATE, [
                init(),
                READY,
                connected("2001:db8::1", 50_000),
                connected("2001:db8::2", 50_000),
                disconnected(1, { ip: "2001:db8::1" }),
            ]);

            expect(
                state.activeConnections.map((c) => {
                    return c.ip;
                }),
            ).toEqual(["2001:db8::2"]);
        });

        it("counts events above init's watermark towards the totals", () => {
            const state = applyEvents(INITIAL_WS_STATE, [
                init({ total_connections: 10, total_bytes_sent: 500, total_time_spent: 100, last_counted_id: 0 }),
                READY,
                disconnected(1, { bytes_sent: 25, time_spent: 5 }),
            ]);

            expect(state.totalConnections).toBe(11);
            expect(state.totalBytes).toBe(525);
            expect(state.totalTimeSeconds).toBe(105);
        });

        it("fills the feed with events at or below the watermark without touching init's totals", () => {
            const state = applyEvents(INITIAL_WS_STATE, [
                init({ total_connections: 10, total_bytes_sent: 500, total_time_spent: 100, last_counted_id: 2 }),
                disconnected(1, { bytes_sent: 25, time_spent: 5 }),
                disconnected(2, { bytes_sent: 25, time_spent: 5 }),
                READY,
            ]);

            expect(
                state.events.map((event) => {
                    return event.sequence;
                }),
            ).toEqual([1, 2]);
            expect(state.totalConnections).toBe(10);
            expect(state.totalBytes).toBe(500);
            expect(state.totalTimeSeconds).toBe(100);
        });

        it("drops anything at or below the high-water mark", () => {
            const before = applyEvents(INITIAL_WS_STATE, [init(), READY, disconnected(5)]);
            const after = wsReducer(before, disconnected(5));

            expect(after).toBe(before);
        });

        it("caps the feed at 100 events", () => {
            const sequences = Array.from({ length: 105 }, (_element, index) => {
                return index + 1;
            });

            const state = applyEvents(INITIAL_WS_STATE, [
                init(),
                READY,
                ...sequences.map((sequence) => {
                    return disconnected(sequence);
                }),
            ]);

            expect(state.events).toHaveLength(100);
            expect(state.events[0]?.sequence).toBe(6);
            expect(state.events.at(-1)?.sequence).toBe(105);
            expect(state.totalConnections).toBe(105);
        });
    });

    describe("reconnect", () => {
        it("survives an overlapping replay without double-counting", () => {
            const beforeDrop = applyEvents(INITIAL_WS_STATE, [
                init({ total_connections: 2, total_bytes_sent: 200, total_time_spent: 20, last_counted_id: 2 }),
                READY,
                disconnected(3, { bytes_sent: 100, time_spent: 10 }),
            ]);

            expect(beforeDrop.totalConnections).toBe(3);

            const afterReconnect = applyEvents(beforeDrop, [
                init({ total_connections: 3, total_bytes_sent: 300, total_time_spent: 30, last_counted_id: 3 }),
                disconnected(3, { bytes_sent: 100, time_spent: 10 }),
                disconnected(4),
                READY,
                disconnected(5),
            ]);

            expect(
                afterReconnect.events.map((event) => {
                    return event.sequence;
                }),
            ).toEqual([3, 4, 5]);
            expect(afterReconnect.totalConnections).toBe(5);
        });

        it("counts a replayed event the totals don't cover yet", () => {
            const state = applyEvents(INITIAL_WS_STATE, [
                init({ total_connections: 2, total_bytes_sent: 200, total_time_spent: 20, last_counted_id: 2 }),
                disconnected(2, { bytes_sent: 100, time_spent: 10 }),
                disconnected(3, { bytes_sent: 100, time_spent: 10 }),
                READY,
            ]);

            expect(state.totalConnections).toBe(3);
            expect(state.totalBytes).toBe(300);
            expect(state.totalTimeSeconds).toBe(30);
        });
    });
});
