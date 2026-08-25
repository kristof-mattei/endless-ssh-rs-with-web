import type React from "react";
import { Temporal } from "temporal-polyfill";

import type { DisconnectedEvent } from "../hooks/use-web-sockets";
import { formatBytes, formatDuration, formatIp } from "../lib/formatting";
import { CountryFlag } from "./country-flag";

function disconnectedAtToHumanReadable(disconnectedAt: string): string {
    const instant = Temporal.Instant.from(disconnectedAt);

    const localZonedDateTime = instant.toZonedDateTimeISO(Temporal.Now.timeZoneId());

    const humanReadable = localZonedDateTime.toLocaleString([], {
        dateStyle: "full",
        timeStyle: "short",
    });

    return humanReadable;
}

export const EventRow: React.FC<{ event: DisconnectedEvent }> = ({ event }) => {
    const disconnectedAt = disconnectedAtToHumanReadable(event.disconnected_at);

    return (
        <div className="col-span-full grid grid-cols-subgrid items-center rounded-sm bg-gray-800 px-3 py-2 text-sm">
            <CountryFlag country={event.country} />
            <span className="truncate text-gray-400">{event.city ?? "Unknown"}</span>
            <span className="truncate font-mono text-gray-300">{formatIp(event.ip)}</span>
            <span className="truncate ps-3 text-end font-mono text-gray-300">{disconnectedAt}</span>
            <span className="text-end text-red-400">{formatDuration(event.time_spent)}</span>
            <span className="text-end text-gray-500">{formatBytes(event.bytes_sent)}</span>
        </div>
    );
};
