import type React from "react";
import type { Temporal } from "temporal-polyfill";

import { formatBytes, formatDuration } from "../lib/formatting";
import { Stat } from "./stat";

interface Properties {
    activeConnectionsCount: number;
    totalBytesSent: number;
    totalConnections: number;
    totalTimeWasted: Temporal.Duration;
}

export const StatsPanel: React.FC<Properties> = ({
    totalConnections,
    totalBytesSent,
    totalTimeWasted,
    activeConnectionsCount: activeCount,
}) => {
    return (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Total connections" value={totalConnections.toLocaleString()} />
            <Stat label="Active now" value={activeCount.toLocaleString()} />
            <Stat label="Bytes wasted" value={formatBytes(totalBytesSent)} />
            <Stat label="Time wasted" value={formatDuration(totalTimeWasted)} />
        </div>
    );
};
