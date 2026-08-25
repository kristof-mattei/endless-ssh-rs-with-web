import type React from "react";
import { Temporal } from "temporal-polyfill";

import type { DisconnectedEvent } from "../hooks/use-web-sockets";
import { EventRow } from "./event-row";

interface Properties {
    events: DisconnectedEvent[];
}

function getTimezone(): string {
    const now: Temporal.ZonedDateTime = Temporal.Now.zonedDateTimeISO();

    // signHH:MM as a string offset (e.g., -07:00)
    const { offset } = now;

    const format = new Intl.DateTimeFormat([], {
        timeZone: now.timeZoneId,
        timeZoneName: "long",
    });
    const parts = format.formatToParts();

    // long-form descriptive name
    const timeZoneName = parts.find((part) => {
        return part.type === "timeZoneName";
    });

    if (timeZoneName === undefined) {
        return `GMT ${offset}`;
    }

    return `${timeZoneName.value}, GMT ${offset}`;
}

const TIMEZONE = getTimezone();

export const EventFeed: React.FC<Properties> = ({ events }) => {
    return (
        <>
            <h2 className="mbe-2 text-lg font-semibold text-gray-300">Recent disconnections (times in {TIMEZONE})</h2>
            <div
                className="grid grid-cols-[auto_minmax(0,12rem)_minmax(0,max-content)_minmax(0,1fr)_max-content_max-content] gap-x-3 gap-y-1 overflow-y-auto max-block-100"
                role="log"
            >
                {events.length === 0 && (
                    <p className="col-span-full py-6 text-center text-gray-500">Waiting for connections…</p>
                )}
                {events.toReversed().map((event) => {
                    return <EventRow event={event} key={event.sequence} />;
                })}
            </div>
        </>
    );
};
