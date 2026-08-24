import { useEffect, useRef, useState } from "react";

import type { WsEvent } from "../generated/WsEvent";

export type ConnectionStatus = "connecting" | "live" | "reconnecting";

export type ConnectedEvent = Extract<WsEvent, { type: "connected" }>;
export type DisconnectedEvent = Extract<WsEvent, { type: "disconnected" }>;
export type InitEvent = Extract<WsEvent, { type: "init" }>;
export type ReadyEvent = Extract<WsEvent, { type: "ready" }>;

interface Options {
    /** The highest `disconnected` sequence already applied. A reconnect replays everything after it. */
    getSince: () => number;
    onEvent: (event: WsEvent) => void;
}

const BASE_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 30_000;
const STABLE_CONNECTION_MS = 5000;

// three missed server heartbeats (30 seconds each), a half-dead connection never fires close on its own
const WATCHDOG_TIMEOUT_MS = 90_000;

// RFC 6455 close code 1000, Normal Closure
const NORMAL_CLOSURE_CODE = 1000;

// per spec, close() on a CONNECTING socket fails the connection without a close handshake, so defer until open
function closeSocket(ws: WebSocket): void {
    if (ws.readyState === WebSocket.CONNECTING) {
        ws.addEventListener(
            "open",
            () => {
                ws.close(NORMAL_CLOSURE_CODE);
            },
            { once: true },
        );

        return;
    }

    if (ws.readyState === WebSocket.OPEN) {
        ws.close(NORMAL_CLOSURE_CODE);
    }
}

export function useWebSocket({ getSince, onEvent }: Options): { status: ConnectionStatus } {
    const [status, setStatus] = useState<ConnectionStatus>("connecting");

    // stable callback references
    const onEventReference = useRef(onEvent);
    const sinceGetterReference = useRef(getSince);

    useEffect(() => {
        onEventReference.current = onEvent;
        sinceGetterReference.current = getSince;
    }, [getSince, onEvent]);

    useEffect(() => {
        let isDisposed = false;
        let socket: null | WebSocket = null;
        let retryTimer: null | ReturnType<typeof setTimeout> = null;
        let stableTimer: null | ReturnType<typeof setTimeout> = null;
        let watchdogTimer: null | ReturnType<typeof setTimeout> = null;
        let backoff = BASE_BACKOFF_MS;

        function clearWatchdog(): void {
            if (watchdogTimer === null) {
                return;
            }

            clearTimeout(watchdogTimer);
            watchdogTimer = null;
        }

        function connect(): void {
            const since = sinceGetterReference.current();

            const url = `${globalThis.location.protocol === "https:" ? "wss" : "ws"}://${globalThis.location.host}/api/ws?since=${since.toString()}`;

            const ws = new WebSocket(url);
            socket = ws;

            function armWatchdog(): void {
                clearWatchdog();

                watchdogTimer = setTimeout(() => {
                    // nothing received within the window, the connection is half-dead: force the reconnect path
                    closeSocket(ws);
                }, WATCHDOG_TIMEOUT_MS);
            }

            ws.addEventListener("open", () => {
                if (isDisposed) {
                    return;
                }

                armWatchdog();

                setStatus("live");

                // reset only once the connection proves stable, an accept-then-drop loop must keep growing the backoff
                stableTimer = setTimeout(() => {
                    backoff = BASE_BACKOFF_MS;
                }, STABLE_CONNECTION_MS);
            });

            ws.addEventListener("message", (message: MessageEvent<unknown>) => {
                if (isDisposed) {
                    return;
                }

                // any frame proves liveness, heartbeats included
                armWatchdog();

                if (typeof message.data !== "string") {
                    console.error("Ignoring non-text WebSocket frame", message.data);

                    return;
                }

                const event = ((): undefined | WsEvent => {
                    try {
                        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- trusted source
                        return JSON.parse(message.data) as WsEvent;
                    } catch (error) {
                        console.error("Ignoring malformed WebSocket frame", error);

                        return undefined;
                    }
                })();

                if (event === undefined) {
                    return;
                }

                onEventReference.current(event);
            });

            ws.addEventListener("close", () => {
                if (stableTimer !== null) {
                    clearTimeout(stableTimer);
                    stableTimer = null;
                }

                clearWatchdog();

                if (isDisposed) {
                    return;
                }

                // before the first open there is no stale data to flag, stay on "connecting"
                setStatus((current) => {
                    return current === "connecting" ? "connecting" : "reconnecting";
                });

                // exponential backoff reconnect
                retryTimer = setTimeout(() => {
                    backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
                    connect();
                }, backoff);
            });
        }

        // cut a pending backoff wait short when conditions change in our favor
        function retryNow(): void {
            if (retryTimer === null) {
                return;
            }

            clearTimeout(retryTimer);
            retryTimer = null;
            connect();
        }

        function onVisibilityChange(): void {
            if (document.visibilityState === "visible") {
                retryNow();
            }
        }

        connect();

        globalThis.addEventListener("online", retryNow);
        document.addEventListener("visibilitychange", onVisibilityChange);

        return (): void => {
            isDisposed = true;

            globalThis.removeEventListener("online", retryNow);
            document.removeEventListener("visibilitychange", onVisibilityChange);

            if (retryTimer !== null) {
                clearTimeout(retryTimer);
            }

            if (stableTimer !== null) {
                clearTimeout(stableTimer);
            }

            clearWatchdog();

            if (socket !== null) {
                closeSocket(socket);
            }
        };
    }, []);

    return { status };
}
