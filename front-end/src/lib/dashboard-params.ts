import type { Options, SingleParser } from "nuqs";
import { createParser, parseAsStringLiteral } from "nuqs";
import type { Temporal } from "temporal-polyfill";

import type { Metric } from "./metrics";
import { METRIC_KEYS } from "./metrics";

// The dashboard's URL contract. Every selectable value has a slug here, and the components read
// state only through these parsers.

// `Metric` indexes `BucketPoint`, so the URL needs its own vocabulary rather than the column names.
const METRIC_SLUGS = {
    bytes_sent: "bytes-wasted",
    connects: "connections",
    time_spent: "time-wasted",
} as const satisfies Record<Metric, string>;

// Defaults stay in the URL, so changing one later cannot re-point links already shared.
const PARSER_OPTIONS = { clearOnDefault: false, history: "push" } as const;

type DashboardParser<Value> = { defaultValue: Value } & Options & SingleParser<Value>;

export interface RangeDefinition {
    label: string;
    // `null` is the open-ended query
    window: null | Temporal.DurationLike;
}

// `Range` never leaves the client, so its values double as the URL slugs.
export const RANGE_SLUGS = ["1-hour", "24-hours", "7-days", "30-days", "all-time"] as const;

export type Range = (typeof RANGE_SLUGS)[number];

// Windows are in hours because the fetch subtracts them from an `Instant`, which takes no calendar units.
export const RANGES: Readonly<Record<Range, RangeDefinition>> = {
    "1-hour": { label: "Last hour", window: { hours: 1 } },
    "24-hours": { label: "Last 24 h", window: { hours: 24 } },
    "7-days": { label: "Last 7 days", window: { hours: 7 * 24 } },
    "30-days": { label: "Last 30 days", window: { hours: 30 * 24 } },
    "all-time": { label: "All time", window: null },
};

export interface RefreshDefinition {
    // `null` disables the timer
    interval: null | Temporal.DurationLike;
    label: string;
}

// "off" is a value like any other, so the URL states it instead of implying it by absence.
export const REFRESH_SLUGS = ["off", "10s", "30s", "1m", "5m"] as const;

export type RefreshLabel = (typeof REFRESH_SLUGS)[number];

export const REFRESH_INTERVALS: Readonly<Record<RefreshLabel, RefreshDefinition>> = {
    off: { interval: null, label: "Off" },
    "10s": { interval: { seconds: 10 }, label: "10s" },
    "30s": { interval: { seconds: 30 }, label: "30s" },
    "1m": { interval: { minutes: 1 }, label: "1m" },
    "5m": { interval: { minutes: 5 }, label: "5m" },
};

// The whole contract in one object: `useCanonicalUrl` writes all of it, each component reads its own key.
export const DASHBOARD_PARAMS: {
    metric: DashboardParser<Metric>;
    range: DashboardParser<Range>;
    refresh: DashboardParser<RefreshLabel>;
} = {
    metric: createParser<Metric>({
        parse: (value) => {
            return (
                METRIC_KEYS.find((metric) => {
                    return METRIC_SLUGS[metric] === value;
                }) ?? null
            );
        },
        serialize: (value) => {
            return METRIC_SLUGS[value];
        },
    })
        .withDefault("connects")
        .withOptions(PARSER_OPTIONS),
    range: parseAsStringLiteral(RANGE_SLUGS).withDefault("24-hours").withOptions(PARSER_OPTIONS),
    refresh: parseAsStringLiteral(REFRESH_SLUGS).withDefault("off").withOptions(PARSER_OPTIONS),
};
