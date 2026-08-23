import type React from "react";
import { useEffect, useState } from "react";
import { Temporal } from "temporal-polyfill";

import type { ActiveConnectionInfo } from "../generated/ActiveConnectionInfo";
import { formatBytes, formatDuration, formatIp } from "../lib/formatting";
import { CountryFlag } from "./country-flag";

interface Properties {
    activeConnections: ActiveConnectionInfo[];
}

function useNow(): Temporal.Instant {
    const [now, setNow] = useState(() => {
        return Temporal.Now.instant();
    });

    useEffect(() => {
        const id = setInterval(() => {
            setNow(Temporal.Now.instant());
        }, 1000);

        return (): void => {
            clearInterval(id);
        };
    }, []);

    return now;
}

function secondsConnected(connectedAt: string, now: Temporal.Instant): number {
    const milliseconds = now.epochMilliseconds - Temporal.Instant.from(connectedAt).epochMilliseconds;

    return Math.max(0, Math.floor(milliseconds / 1000));
}

const ConnectionRow: React.FC<{ connection: ActiveConnectionInfo; now: Temporal.Instant }> = ({ connection, now }) => {
    const ip = formatIp(connection.ip);

    return (
        <div className="col-span-full grid grid-cols-subgrid items-center rounded-sm bg-gray-800 px-3 py-2 text-sm">
            <CountryFlag countryCode={connection.country_code} countryName={connection.country_name} />
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

export const ActiveConnections: React.FC<Properties> = ({ activeConnections }) => {
    const now = useNow();

    return (
        <div className="flex flex-col rounded-lg bg-gray-900 p-3 block-[350px]">
            <h3 className="mbe-2 text-sm font-semibold text-gray-400">Active connections</h3>

            <div className="grid flex-1 grid-cols-[auto_minmax(0,max-content)_minmax(3rem,1fr)_max-content_max-content] content-start gap-x-3 gap-y-1 overflow-y-auto min-block-0">
                {activeConnections.length === 0 && (
                    <p className="col-span-full py-6 text-center text-gray-500">No active connections</p>
                )}
                {activeConnections.map((connection) => {
                    return (
                        <ConnectionRow
                            connection={connection}
                            key={`${connection.ip}:${connection.port.toString()}`}
                            now={now}
                        />
                    );
                })}
            </div>
        </div>
    );
};
