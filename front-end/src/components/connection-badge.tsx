import type React from "react";

import type { EventSourceStatus } from "../hooks/use-event-source";

const CONNECTION_STATUS_STYLES: Record<EventSourceStatus, { dot: string; text: string }> = {
    connecting: { dot: "bg-gray-500", text: "text-fg-muted" },
    demo: { dot: "bg-purple-500", text: "text-purple-fg" },
    live: { dot: "bg-green-500", text: "text-green-fg" },
    outdated: { dot: "bg-red-500", text: "text-red-fg" },
    reconnecting: { dot: "bg-amber-500", text: "text-amber-fg" },
};

export const ConnectionBadge: React.FC<{ status: EventSourceStatus }> = ({ status }) => {
    const { dot, text } = CONNECTION_STATUS_STYLES[status];

    return (
        <span className={`flex items-center gap-1.5 text-sm ${text}`}>
            <span aria-hidden="true" className={`rounded-full block-2 inline-2 ${dot}`} />
            {status}
        </span>
    );
};
