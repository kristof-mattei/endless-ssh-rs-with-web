import type { WsEvent } from "../generated/WsEvent";
import { useDemoWebSocket } from "./use-demo-web-socket";
import type { ConnectionStatus } from "./use-web-sockets";
import { useWebSocket } from "./use-web-sockets";

export type EventSourceStatus = "demo" | ConnectionStatus;

export interface EventSourceOptions {
    getSince: () => number;
    onEvent: (event: WsEvent) => void;
}

// ?demo replaces the live WebSocket with locally generated random traffic. The choice is made once per page load,
// so a component calls one statically known hook.
export const useEventSource: (options: EventSourceOptions) => { status: EventSourceStatus } = new URLSearchParams(
    globalThis.location.search,
).has("demo")
    ? useDemoWebSocket
    : useWebSocket;
