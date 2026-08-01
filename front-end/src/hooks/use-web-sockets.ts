import { useEffect, useRef } from "react";

export interface ConnectedEvent {
    type: "connected";
    ip: string;
    port: number;
    connected_at: string;
    country_code: null | string;
    country_name: null | string;
    city: null | string;
    latitude: null | number;
    longitude: null | number;
}

export interface DisconnectedEvent {
    type: "disconnected";
    sequence: number;
    ip: string;
    port: number;
    connected_at: string;
    disconnected_at: string;
    time_spent: number;
    bytes_sent: number;
    country_code: null | string;
    country_name: null | string;
    city: null | string;
    latitude: null | number;
    longitude: null | number;
}

export interface InitEvent {
    type: "init";
    active_connections: ActiveConnection[];
    total_connections: number;
    total_bytes_sent: number;
    total_time_spent: number;
}

export interface ReadyEvent {
    type: "ready";
}

export interface ActiveConnection {
    ip: string;
    port: number;
    connected_at: string;
    latitude: null | number;
    longitude: null | number;
    country_code: null | string;
    country_name: null | string;
    city: null | string;
}

export type WsEvent = ConnectedEvent | DisconnectedEvent | InitEvent | ReadyEvent;

interface Options {
    onEvent: (event: WsEvent) => void;
}

const BASE_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 30_000;
const STABLE_CONNECTION_MS = 5000;

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

export function useWebSocket({ onEvent }: Options): void {
    const lastSequenceReference = useRef(0);

    // stable callback reference
    const onEventReference = useRef(onEvent);

    useEffect(() => {
        onEventReference.current = onEvent;
    }, [onEvent]);

    useEffect(() => {
        let isDisposed = false;
        let socket: null | WebSocket = null;
        let retryTimer: null | ReturnType<typeof setTimeout> = null;
        let stableTimer: null | ReturnType<typeof setTimeout> = null;
        let backoff = BASE_BACKOFF_MS;

        function connect(): void {
            const since = lastSequenceReference.current;

            const url = `${globalThis.location.protocol === "https:" ? "wss" : "ws"}://${globalThis.location.host}/api/ws?since=${since.toString()}`;

            const ws = new WebSocket(url);
            socket = ws;

            ws.addEventListener("open", () => {
                if (isDisposed) {
                    return;
                }

                // reset only once the connection proves stable, an accept-then-drop loop must keep growing the backoff
                stableTimer = setTimeout(() => {
                    backoff = BASE_BACKOFF_MS;
                }, STABLE_CONNECTION_MS);
            });

            ws.addEventListener("message", (message: MessageEvent<string>) => {
                if (isDisposed) {
                    return;
                }

                const event = ((): undefined | WsEvent => {
                    try {
                        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- trusted source
                        return JSON.parse(message.data) as WsEvent;
                    } catch {
                        return undefined;
                    }
                })();

                if (event === undefined) {
                    return;
                }

                // track last sequence for reconnect no-gap
                if (event.type === "disconnected") {
                    lastSequenceReference.current = event.sequence;
                }

                onEventReference.current(event);
            });

            ws.addEventListener("close", () => {
                if (stableTimer !== null) {
                    clearTimeout(stableTimer);
                    stableTimer = null;
                }

                if (isDisposed) {
                    return;
                }

                // exponential backoff reconnect
                retryTimer = setTimeout(() => {
                    backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
                    connect();
                }, backoff);
            });
        }

        connect();

        return () => {
            isDisposed = true;

            if (retryTimer !== null) {
                clearTimeout(retryTimer);
            }

            if (stableTimer !== null) {
                clearTimeout(stableTimer);
            }

            if (socket !== null) {
                closeSocket(socket);
            }
        };
    }, []);
}
