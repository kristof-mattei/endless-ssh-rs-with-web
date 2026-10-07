import { Temporal } from "temporal-polyfill";

import type { StatsResponse } from "../generated/StatsResponse";
import type { WsEvent } from "../generated/WsEvent";

// The back-end writes every timestamp as `{ "$instant": "<RFC 3339>" }` and every duration as
// `{ "$duration": "<ISO 8601>" }`, the way MongoDB's Extended JSON tags values JSON cannot represent. `JSON.parse` hands
// the reviver a property's value after its children are done, so a wrapper is seen whole at its holder's key and
// replaced there; the bindings' `Temporal.Instant` and `Temporal.Duration` hold at any depth.

function isInstant(value: unknown): value is { $instant: string } {
    return typeof value === "object" && value !== null && "$instant" in value && typeof value.$instant === "string";
}

function isDuration(value: unknown): value is { $duration: string } {
    return typeof value === "object" && value !== null && "$duration" in value && typeof value.$duration === "string";
}

function reviveTagged(_key: string, value: unknown): unknown {
    if (isInstant(value)) {
        return Temporal.Instant.from(value.$instant);
    }

    if (isDuration(value)) {
        return Temporal.Duration.from(value.$duration);
    }

    return value;
}

// The two places wire JSON becomes objects; the casts are the trust in our own back-end. A wrapper the polyfill
// rejects fails the parse, which the callers already treat as a malformed message.
export function parseWsEvent(text: string): WsEvent {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- our own back-end, shaped by the ts-rs bindings
    return JSON.parse(text, reviveTagged) as WsEvent;
}

export function parseStatsResponse(text: string): StatsResponse {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- our own back-end, shaped by the ts-rs bindings
    return JSON.parse(text, reviveTagged) as StatsResponse;
}
