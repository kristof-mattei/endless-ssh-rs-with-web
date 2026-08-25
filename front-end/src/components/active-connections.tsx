import type React from "react";
import { useEffect, useState } from "react";
import { Temporal } from "temporal-polyfill";

import type { ActiveConnectionInfo } from "../generated/ActiveConnectionInfo";
import { ConnectionRow } from "./connection-row";

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
