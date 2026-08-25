import type React from "react";

import { formatBytes, formatDuration } from "../lib/formatting";
import { Stat } from "./stat";

interface Properties {
    activeConnectionsCount: number;
    totalBytesSent: number;
    totalConnections: number;
    totalSecondsWasted: number;
}

export const StatsPanel: React.FC<Properties> = ({
    totalConnections,
    totalBytesSent,
    totalSecondsWasted,
    activeConnectionsCount: activeCount,
}) => {
    return (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Total connections" value={totalConnections.toLocaleString()} />
            <Stat label="Active now" value={activeCount.toLocaleString()} />
            <Stat label="Bytes wasted" value={formatBytes(totalBytesSent)} />
            <Stat label="Time wasted" value={formatDuration(totalSecondsWasted)} />
        </div>
    );
};
