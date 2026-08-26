import type React from "react";
import type { Temporal } from "temporal-polyfill";

import type { ActiveConnectionInfo } from "../generated/ActiveConnectionInfo";
import { formatBytes, formatDuration, formatIp } from "../lib/formatting";
import { CountryFlag } from "./country-flag";

function secondsConnected(connectedAt: Temporal.Instant, now: Temporal.Instant): number {
    return Math.max(0, connectedAt.until(now).total("seconds"));
}

export const ConnectionRow: React.FC<{ connection: ActiveConnectionInfo; now: Temporal.Instant }> = ({
    connection,
    now,
}) => {
    const ip = formatIp(connection.ip);

    return (
        <div className="col-span-full grid grid-cols-subgrid items-center rounded-sm bg-gray-800 px-3 py-2 text-sm">
            <CountryFlag country={connection.country} />
            <span className="truncate text-gray-400">{connection.city ?? "Unknown"}</span>
            <span className="truncate font-mono text-gray-300" title={ip}>
                {ip}
            </span>
            <span className="text-end text-green-400">
                {formatDuration(secondsConnected(connection.connected_at, now))}
            </span>
            <span className="text-end text-gray-500">{formatBytes(connection.bytes_sent)}</span>
        </div>
    );
};
