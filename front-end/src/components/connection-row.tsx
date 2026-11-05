import type React from "react";

import type { ActiveConnectionInfo } from "../generated/ActiveConnectionInfo";
import { formatBytes, formatDuration, formatIp } from "../lib/formatting";
import { CountryFlag } from "./country-flag";

function timeConnected(connectedAt: Temporal.Instant, now: Temporal.Instant): Temporal.Duration {
    const elapsed = connectedAt.until(now);

    return elapsed.sign < 0 ? new Temporal.Duration() : elapsed;
}

export const ConnectionRow: React.FC<{ connection: ActiveConnectionInfo; now: Temporal.Instant }> = ({
    connection,
    now,
}) => {
    const ip = formatIp(connection.ip);

    return (
        <div className="col-span-full grid grid-cols-subgrid items-center rounded-sm bg-panel px-3 py-2 text-sm">
            <CountryFlag country={connection.country} />
            <span className="truncate text-fg-muted">{connection.city ?? "Unknown"}</span>
            <span className="truncate font-mono text-fg-soft" title={ip}>
                {ip}
            </span>
            <span className="text-end text-green-fg">
                {formatDuration(timeConnected(connection.connected_at, now))}
            </span>
            <span className="text-end text-fg-subtle">{formatBytes(connection.bytes_sent)}</span>
        </div>
    );
};
