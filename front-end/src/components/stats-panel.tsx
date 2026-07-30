import type * as React from "react";

import { formatBytes, formatDuration } from "../lib/formatting";

interface Properties {
    totalConnections: number;
    totalBytesSent: number;
    totalSecondsWasted: number;
    activeConnectionsCount: number;
}

const Stat: React.FC<{ label: string; value: string }> = ({ label, value }) => {
    return (
        <div className="flex flex-col items-center rounded-lg bg-gray-800 p-4">
            <span className="text-2xl font-bold text-white">{value}</span>
            <span className="mt-1 text-sm text-gray-400">{label}</span>
        </div>
    );
};

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
