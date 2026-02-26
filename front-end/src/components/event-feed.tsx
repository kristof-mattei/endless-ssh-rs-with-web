import type React from "react";

import type { DisconnectedEvent } from "@/hooks/use-web-sockets.ts";
import { formatBytes, formatDuration } from "@/lib/formatting.ts";

interface Properties {
    events: DisconnectedEvent[];
}

function countryFlag(code: null | string): string {
    if (code?.length !== 2) {
        return "🌐";
    }

    // prettier-ignore
    const base = 0x01_F1_E6;
    const upper = code.toUpperCase();
    const cp0 = upper.codePointAt(0);
    const cp1 = upper.codePointAt(1);

    if (cp0 === undefined || cp1 === undefined) {
        return "🌐";
    }
    return String.fromCodePoint(base + cp0 - 65) + String.fromCodePoint(base + cp1 - 65);
}

const EventRow: React.FC<{ event: DisconnectedEvent }> = ({ event }) => {
    return (
        <div className="flex items-center gap-3 rounded bg-gray-800 px-3 py-2 text-sm">
            <span className="text-lg" title={event.country_code ?? undefined}>
                {countryFlag(event.country_code)}
            </span>
            <span className="w-36 truncate font-mono text-gray-300">{event.ip}</span>
            <span className="text-gray-400">{event.city ?? event.country_name ?? "Unknown"}</span>
            <span className="ml-auto text-red-400">{formatDuration(event.time_spent)}</span>
            <span className="text-gray-500">{formatBytes(event.bytes_sent)}</span>
        </div>
    );
};

export const EventFeed: React.FC<Properties> = ({ events }) => {
    return (
        <div className="flex flex-col gap-1 overflow-y-auto" style={{ maxHeight: "400px" }}>
            {events.length === 0 && <p className="py-6 text-center text-gray-500">Waiting for connections…</p>}
            {events.toReversed().map((event) => {
                return <EventRow key={event.seq} event={event} />;
            })}
        </div>
    );
};
