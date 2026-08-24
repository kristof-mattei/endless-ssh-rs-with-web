import { act, renderHook } from "@testing-library/react";
import type { Mock } from "vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { WsEvent } from "../generated/WsEvent";
import type { ConnectionStatus } from "./use-web-sockets";
import { useWebSocket } from "./use-web-sockets";

// RFC 6455 close code 1000, Normal Closure, the code the hook sends
const NORMAL_CLOSURE_CODE = 1000;

class FakeWebSocket extends EventTarget {
    /* oxlint-disable perfectionist/sort-classes -- the readyState constants read in their spec-defined numeric order */
    public static readonly CONNECTING = 0;
    public static readonly OPEN = 1;
    public static readonly CLOSING = 2;
    public static readonly CLOSED = 3;
    /* oxlint-enable perfectionist/sort-classes -- the exception covers the fake only */

    public static instances: FakeWebSocket[] = [];
    public closeCalls: (number | undefined)[] = [];
    public readyState: number = FakeWebSocket.CONNECTING;
    public readonly url: string;

    public constructor(url: string) {
        super();

        this.url = url;
        FakeWebSocket.instances.push(this);
    }

    public close(code?: number): void {
        this.closeCalls.push(code);
        this.readyState = FakeWebSocket.CLOSED;
    }

    public open(): void {
        this.readyState = FakeWebSocket.OPEN;
        this.dispatchEvent(new Event("open"));
    }

    public serverClose(): void {
        this.readyState = FakeWebSocket.CLOSED;
        this.dispatchEvent(new Event("close"));
    }

    public serverMessage(data: unknown): void {
        this.dispatchEvent(new MessageEvent("message", { data }));
    }
}

function latestSocket(): FakeWebSocket {
    const socket = FakeWebSocket.instances.at(-1);

    if (socket === undefined) {
        throw new Error("no WebSocket was constructed");
    }

    return socket;
}

function renderWebSocketHook(): {
    getSince: Mock<() => number>;
    onEvent: Mock<(event: WsEvent) => void>;
    result: { current: { status: ConnectionStatus } };
    unmount: () => void;
} {
    const onEvent = vi.fn<(event: WsEvent) => void>();
    const getSince = vi.fn<() => number>(() => {
        return 0;
    });

    const { result, unmount } = renderHook(() => {
        return useWebSocket({ getSince, onEvent });
    });

    return { getSince, onEvent, result, unmount };
}

function advance(milliseconds: number): void {
    act(() => {
        vi.advanceTimersByTime(milliseconds);
    });
}

function openLatest(): void {
    act(() => {
        latestSocket().open();
    });
}

function dropLatest(): void {
    act(() => {
        latestSocket().serverClose();
    });
}

describe("useWebSocket", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        FakeWebSocket.instances = [];
        vi.stubGlobal("WebSocket", FakeWebSocket);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("starts in connecting and dials with the replay cursor at 0", () => {
        const { result } = renderWebSocketHook();

        expect(result.current.status).toBe("connecting");
        expect(FakeWebSocket.instances).toHaveLength(1);
        expect(latestSocket().url).toMatch(/^ws:/v);
        expect(latestSocket().url).toContain("/api/ws?since=0");
    });

    it("goes live on open", () => {
        const { result } = renderWebSocketHook();

        openLatest();

        expect(result.current.status).toBe("live");
    });

    it("stays in connecting when the socket drops before ever opening", () => {
        const { result } = renderWebSocketHook();

        dropLatest();

        expect(result.current.status).toBe("connecting");
    });

    it("flags reconnecting when a live connection drops, live again once it recovers", () => {
        const { result } = renderWebSocketHook();

        openLatest();
        dropLatest();

        expect(result.current.status).toBe("reconnecting");

        advance(500);
        openLatest();

        expect(result.current.status).toBe("live");
    });

    it("retries with exponential backoff", () => {
        renderWebSocketHook();

        dropLatest();

        advance(499);
        expect(FakeWebSocket.instances).toHaveLength(1);
        advance(1);
        expect(FakeWebSocket.instances).toHaveLength(2);

        dropLatest();

        advance(999);
        expect(FakeWebSocket.instances).toHaveLength(2);
        advance(1);
        expect(FakeWebSocket.instances).toHaveLength(3);

        dropLatest();

        advance(1999);
        expect(FakeWebSocket.instances).toHaveLength(3);
        advance(1);
        expect(FakeWebSocket.instances).toHaveLength(4);
    });

    it("caps the backoff at 30 seconds", () => {
        renderWebSocketHook();

        dropLatest();

        for (const wait of [500, 1000, 2000, 4000, 8000, 16_000, 30_000, 30_000]) {
            const before = FakeWebSocket.instances.length;

            advance(wait - 1);
            expect(FakeWebSocket.instances).toHaveLength(before);

            advance(1);
            expect(FakeWebSocket.instances).toHaveLength(before + 1);

            dropLatest();
        }
    });

    it("resets the backoff once a connection stays up for 5 seconds", () => {
        renderWebSocketHook();

        dropLatest();
        advance(500);

        // backoff has doubled to 1000 by now, but this connection proves stable
        openLatest();
        advance(5000);
        dropLatest();

        advance(499);
        expect(FakeWebSocket.instances).toHaveLength(2);
        advance(1);
        expect(FakeWebSocket.instances).toHaveLength(3);
    });

    it("keeps growing the backoff for connections that drop before proving stable", () => {
        renderWebSocketHook();

        dropLatest();
        advance(500);

        // opens but drops just before the 5 second stability mark
        openLatest();
        advance(4999);
        dropLatest();

        advance(999);
        expect(FakeWebSocket.instances).toHaveLength(2);
        advance(1);
        expect(FakeWebSocket.instances).toHaveLength(3);
    });

    it("delivers parsed events to onEvent", () => {
        const { onEvent } = renderWebSocketHook();

        openLatest();

        act(() => {
            latestSocket().serverMessage(JSON.stringify({ type: "ready" }));
        });

        expect(onEvent).toHaveBeenCalledWith({ type: "ready" });
    });

    it("dials the reconnect with the sequence getSince reports", () => {
        const { getSince } = renderWebSocketHook();

        openLatest();
        getSince.mockReturnValue(42);

        dropLatest();
        advance(500);

        expect(latestSocket().url).toContain("/api/ws?since=42");
    });

    it("force-closes a half-dead connection when the watchdog expires", () => {
        renderWebSocketHook();

        openLatest();

        advance(89_999);
        expect(latestSocket().closeCalls).toEqual([]);

        advance(1);
        expect(latestSocket().closeCalls).toEqual([NORMAL_CLOSURE_CODE]);
    });

    it("re-arms the watchdog on any frame", () => {
        renderWebSocketHook();

        openLatest();
        advance(60_000);

        act(() => {
            latestSocket().serverMessage(JSON.stringify({ type: "heartbeat" }));
        });

        // 120 seconds since open, but only 60 since the last frame
        advance(60_000);
        expect(latestSocket().closeCalls).toEqual([]);

        advance(30_000);
        expect(latestSocket().closeCalls).toEqual([NORMAL_CLOSURE_CODE]);
    });

    it("ignores malformed and non-text frames", () => {
        const consoleError = vi.spyOn(console, "error").mockImplementation(() => {
            // suppress the expected noise
        });

        const { onEvent } = renderWebSocketHook();

        openLatest();

        act(() => {
            latestSocket().serverMessage("{ not json");
            latestSocket().serverMessage(new ArrayBuffer(8));
        });

        expect(onEvent).not.toHaveBeenCalled();
        expect(consoleError).toHaveBeenCalledTimes(2);
    });

    it("defers close until open when unmounted while still connecting", () => {
        const { unmount } = renderWebSocketHook();

        unmount();

        expect(latestSocket().closeCalls).toEqual([]);

        openLatest();

        expect(latestSocket().closeCalls).toEqual([NORMAL_CLOSURE_CODE]);
    });

    it("closes an open socket on unmount", () => {
        const { unmount } = renderWebSocketHook();

        openLatest();
        unmount();

        expect(latestSocket().closeCalls).toEqual([NORMAL_CLOSURE_CODE]);
    });

    it("goes silent after unmount", () => {
        const { onEvent, unmount } = renderWebSocketHook();

        openLatest();
        unmount();

        act(() => {
            latestSocket().serverMessage(JSON.stringify({ type: "ready" }));
            latestSocket().serverClose();
        });
        advance(120_000);

        expect(onEvent).not.toHaveBeenCalled();
        expect(FakeWebSocket.instances).toHaveLength(1);
    });

    it("cancels a pending reconnect on unmount", () => {
        const { unmount } = renderWebSocketHook();

        dropLatest();
        unmount();
        advance(120_000);

        expect(FakeWebSocket.instances).toHaveLength(1);
    });

    it("reconnects immediately when the browser comes back online", () => {
        renderWebSocketHook();

        dropLatest();

        act(() => {
            globalThis.dispatchEvent(new Event("online"));
        });

        expect(FakeWebSocket.instances).toHaveLength(2);

        // the pending retry was consumed, not left behind as a duplicate
        advance(120_000);
        expect(FakeWebSocket.instances).toHaveLength(2);
    });

    it("reconnects immediately when the tab becomes visible", () => {
        renderWebSocketHook();

        dropLatest();

        act(() => {
            document.dispatchEvent(new Event("visibilitychange"));
        });

        expect(FakeWebSocket.instances).toHaveLength(2);
    });

    it("stays put when visibility changes while hidden", () => {
        Object.defineProperty(document, "visibilityState", {
            configurable: true,
            get: () => {
                return "hidden";
            },
        });

        renderWebSocketHook();

        dropLatest();

        act(() => {
            document.dispatchEvent(new Event("visibilitychange"));
        });

        expect(FakeWebSocket.instances).toHaveLength(1);

        Reflect.deleteProperty(document, "visibilityState");
    });

    it("ignores online events while connected", () => {
        renderWebSocketHook();

        openLatest();

        act(() => {
            globalThis.dispatchEvent(new Event("online"));
        });

        expect(FakeWebSocket.instances).toHaveLength(1);
    });
});
