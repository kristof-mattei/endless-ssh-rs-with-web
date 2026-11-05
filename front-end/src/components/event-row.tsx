import type React from "react";

import type { DisconnectedEvent } from "../hooks/use-web-sockets";
import { formatBytes, formatDuration, formatIp } from "../lib/formatting";
import { CountryFlag } from "./country-flag";

function disconnectedAtToHumanReadable(disconnectedAt: Temporal.Instant): string {
    const localZonedDateTime = disconnectedAt.toZonedDateTimeISO(Temporal.Now.timeZoneId());

    return localZonedDateTime.toLocaleString([], {
        dateStyle: "full",
        timeStyle: "short",
    });
}

export const EventRow: React.FC<{ event: DisconnectedEvent }> = ({ event }) => {
    const disconnectedAt = disconnectedAtToHumanReadable(event.disconnected_at);

    return (
        <div className="col-span-full grid grid-cols-subgrid items-center rounded-sm bg-panel px-3 py-2 text-sm">
            <CountryFlag country={event.country} />
            <span className="truncate text-fg-muted">{event.city ?? "Unknown"}</span>
            <span className="truncate font-mono text-fg-soft">{formatIp(event.ip)}</span>
            <span className="truncate ps-3 text-end font-mono text-fg-soft">{disconnectedAt}</span>
            <span className="text-end text-red-fg">{formatDuration(event.time_spent)}</span>
            <span className="text-end text-fg-subtle">{formatBytes(event.bytes_sent)}</span>
        </div>
    );
};
