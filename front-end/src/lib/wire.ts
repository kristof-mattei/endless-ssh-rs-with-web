import { Temporal } from "temporal-polyfill";

import type { StatsResponse } from "../generated/StatsResponse";
import type { WsEvent } from "../generated/WsEvent";

// The back-end writes every timestamp as `{ "$instant": "<RFC 3339>" }`, the way MongoDB's Extended JSON tags values
// JSON cannot carry. `JSON.parse` hands the reviver a property's value after its children are done, so the wrapper is
// seen whole at its holder's key and replaced there; the bindings' `Temporal.Instant` holds at any depth.

function isInstant(value: unknown): value is { $instant: string } {
    return typeof value === "object" && value !== null && "$instant" in value && typeof value.$instant === "string";
}

function reviveInstants(_key: string, value: unknown): unknown {
    return isInstant(value) ? Temporal.Instant.from(value.$instant) : value;
}

// The two places wire JSON becomes objects; the casts are the trust in our own back-end. A wrapper the polyfill
// rejects fails the parse, which the callers already treat as a malformed message.
export function parseWsEvent(text: string): WsEvent {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- our own back-end, shaped by the ts-rs bindings
    return JSON.parse(text, reviveInstants) as WsEvent;
}

export function parseStatsResponse(text: string): StatsResponse {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- our own back-end, shaped by the ts-rs bindings
    return JSON.parse(text, reviveInstants) as StatsResponse;
}
