import type * as React from "react";
import { Temporal } from "temporal-polyfill";

import type { DisconnectedEvent } from "../hooks/use-web-sockets";
import { formatBytes, formatDuration, formatIp } from "../lib/formatting";

import { CountryFlag } from "./country-flag";

interface Properties {
    events: DisconnectedEvent[];
}

function getTimezone(): string {
    const now: Temporal.ZonedDateTime = Temporal.Now.zonedDateTimeISO();

    // signHH:MM as a string offset (e.g., -07:00)
    const offset = now.offset;

    const format = new Intl.DateTimeFormat([], {
        timeZone: now.timeZoneId,
        timeZoneName: "long",
    });
    const parts = format.formatToParts();

    // long-form descriptive name
    const timeZoneName = parts.find((p) => {
        return p.type === "timeZoneName";
    });

    if (timeZoneName === undefined) {
        return `GMT ${offset}`;
    }

    return `${timeZoneName.value}, GMT ${offset}`;
}

const TIMEZONE = getTimezone();

function disconnectedAtToHumanReadable(disconnectedAt: string): string {
    const instant = Temporal.Instant.from(disconnectedAt);

    const localZonedDateTime = instant.toZonedDateTimeISO(Temporal.Now.timeZoneId());

    const humanReadable = localZonedDateTime.toLocaleString([], {
        dateStyle: "full",
        timeStyle: "short",
    });

    return humanReadable;
}

const EventRow: React.FC<{ event: DisconnectedEvent }> = ({ event }) => {
    const disconnectedAt = disconnectedAtToHumanReadable(event.disconnected_at);

    return (
        <div className="col-span-full grid grid-cols-subgrid items-center rounded-sm bg-gray-800 px-3 py-2 text-sm">
            <CountryFlag countryCode={event.country_code} countryName={event.country_name} />
            <span className="truncate text-gray-400">{event.city ?? "Unknown"}</span>
            <span className="truncate font-mono text-gray-300">{formatIp(event.ip)}</span>
            <span className="truncate pl-3 text-right font-mono text-gray-300">{disconnectedAt}</span>
            <span className="text-right text-red-400">{formatDuration(event.time_spent)}</span>
            <span className="text-right text-gray-500">{formatBytes(event.bytes_sent)}</span>
        </div>
    );
};

export const EventFeed: React.FC<Properties> = ({ events }) => {
    return (
        <>
            <h2 className="mb-2 text-lg font-semibold text-gray-300">Recent disconnections (times in {TIMEZONE})</h2>
            <div className="grid max-h-100 grid-cols-[auto_minmax(0,12rem)_minmax(0,max-content)_minmax(0,1fr)_max-content_max-content] gap-x-3 gap-y-1 overflow-y-auto">
                {events.length === 0 && (
                    <p className="col-span-full py-6 text-center text-gray-500">Waiting for connections…</p>
                )}
                {events.toReversed().map((event) => {
                    return <EventRow key={event.sequence} event={event} />;
                })}
            </div>
        </>
    );
};
