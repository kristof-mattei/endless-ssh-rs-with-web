import { useEffect, useRef } from "react";

export interface ConnectedEvent {
    type: "connected";
    ip: string;
    connected_at: string;
    lat: null | number;
    lon: null | number;
}

export interface DisconnectedEvent {
    type: "disconnected";
    seq: number;
    ip: string;
    connected_at: string;
    disconnected_at: string;
    time_spent: number;
    bytes_sent: number;
    country_code: null | string;
    country_name: null | string;
    city: null | string;
    lat: null | number;
    lon: null | number;
}

export interface InitEvent {
    type: "init";
    active_connections: ActiveConnection[];
}

export interface ReadyEvent {
    type: "ready";
}

export interface ActiveConnection {
    ip: string;
    connected_at: string;
    lat: null | number;
    lon: null | number;
    country_code: null | string;
}

export type WsEvent = ConnectedEvent | DisconnectedEvent | InitEvent | ReadyEvent;

interface Options {
    onEvent: (event: WsEvent) => void;
}

const BASE_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 30_000;

export function useWebSocket({ onEvent }: Options): void {
    const lastSeqReference = useRef<number>(0);
    const wsReference = useRef<null | WebSocket>(null);
    const backoffReference = useRef<number>(BASE_BACKOFF_MS);
    const retryTimerReference = useRef<null | ReturnType<typeof setTimeout>>(null);

    // stable callback reference
    const onEventReference = useRef(onEvent);

    useEffect(() => {
        onEventReference.current = onEvent;
    }, [onEvent]);

    useEffect(() => {
        function connect(): void {
            const since = lastSeqReference.current;

            const url = `${globalThis.location.protocol === "https:" ? "wss" : "ws"}://${globalThis.location.host}/api/ws?since=${since.toString()}`;

            const ws = new WebSocket(url);
            wsReference.current = ws;

            ws.addEventListener("open", () => {
                backoffReference.current = BASE_BACKOFF_MS;
            });

            ws.addEventListener("message", (message: MessageEvent<string>) => {
                let event: WsEvent;
                try {
                    event = JSON.parse(message.data) as WsEvent;
                } catch {
                    return;
                }

                // track last seq for reconnect no-gap
                if (event.type === "disconnected") {
                    lastSeqReference.current = event.seq;
                }

                onEventReference.current(event);
            });

            ws.addEventListener("close", () => {
                wsReference.current = null;

                // exponential backoff reconnect
                retryTimerReference.current = setTimeout(() => {
                    backoffReference.current = Math.min(backoffReference.current * 2, MAX_BACKOFF_MS);
                    connect();
                }, backoffReference.current);
            });

            ws.addEventListener("error", () => {
                ws.close();
            });
        }

        connect();

        return () => {
            if (retryTimerReference.current !== null) {
                clearTimeout(retryTimerReference.current);
            }

            wsReference.current?.close();
        };
    }, []);
}
