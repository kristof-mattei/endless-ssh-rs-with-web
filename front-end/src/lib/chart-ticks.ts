import { Temporal } from "temporal-polyfill";

import type { BucketGrid } from "./stats-buckets";
import { snapUpToBucket } from "./stats-buckets";

// Axis ticks and tooltip headers need different precision. Tick values from `getTickValues` sit on round boundaries (whole hours, midnights, month starts),
// while the tooltip shows a single bucket at the width the back-end aggregated at.
function formatDayTick(instant: Temporal.Instant): string {
    return instant.toLocaleString([], { day: "numeric", month: "short" });
}

function formatMonthTick(instant: Temporal.Instant): string {
    return instant.toLocaleString([], { month: "short", year: "numeric" });
}

const DAY_MS = 24 * 60 * 60 * 1000;

function getFirstTickAndStep(
    start: Temporal.ZonedDateTime,
    spanHours: number,
): { first: Temporal.ZonedDateTime; step: Temporal.DurationLike } {
    if (spanHours <= 1) {
        return {
            first: start.round({ smallestUnit: "minute", roundingIncrement: 15, roundingMode: "ceil" }),
            step: { minutes: 15 },
        };
    }

    if (spanHours <= 24) {
        return {
            first: start.round({ smallestUnit: "hour", roundingIncrement: 3, roundingMode: "ceil" }),
            step: { hours: 3 },
        };
    }

    const midnight = start.round({ smallestUnit: "day", roundingMode: "ceil" });

    if (spanHours <= 24 * 7) {
        return { first: midnight, step: { days: 1 } };
    }

    if (spanHours <= 24 * 30) {
        // week ticks start on Sunday
        return { first: midnight.add({ days: (7 - midnight.dayOfWeek) % 7 }), step: { weeks: 1 } };
    }

    let monthStart = midnight.with({ day: 1 });

    if (Temporal.ZonedDateTime.compare(monthStart, start) < 0) {
        monthStart = monthStart.add({ months: 1 });
    }

    // month ticks start on quarters
    return { first: monthStart.add({ months: (3 - ((monthStart.month - 1) % 3)) % 3 }), step: { months: 3 } };
}

export function getTickFormatter(spanHours: number): (instant: Temporal.Instant) => string {
    if (spanHours <= 24) {
        const timeZone = Temporal.Now.timeZoneId();

        return (instant) => {
            const local = instant.toZonedDateTimeISO(timeZone);

            // a midnight tick is the day crossing, label it with the date
            if (local.hour === 0 && local.minute === 0) {
                return formatDayTick(instant);
            }

            return instant.toLocaleString([], { hour: "2-digit", minute: "2-digit" });
        };
    }

    if (spanHours <= 24 * 30) {
        return formatDayTick;
    }

    return formatMonthTick;
}

export function getBucketLabelOptions(bucketWidthMs: number): Intl.DateTimeFormatOptions {
    if (bucketWidthMs < DAY_MS) {
        return { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" };
    }

    return { day: "numeric", month: "short", year: "numeric" };
}

// One bar per bucket, so ticks derived from the domain width would land on arbitrary buckets.
// Tick values are computed on local calendar boundaries instead, then snapped up to the bucket grid because
// a boundary is only a bucket when the UTC offset divides the bucket width.
export function getTickValues({ bucketWidthMs, range }: BucketGrid): number[] {
    const spanHours = range.from.until(range.to).total("hours");
    const start = range.from.toZonedDateTimeISO(Temporal.Now.timeZoneId());
    const { first, step } = getFirstTickAndStep(start, spanHours);

    const endMs = range.to.epochMilliseconds;

    const values: number[] = [];

    for (let cursor = first; cursor.epochMilliseconds < endMs; cursor = cursor.add(step)) {
        const bucketMs = snapUpToBucket(cursor.epochMilliseconds, bucketWidthMs);

        if (bucketMs < endMs) {
            values.push(bucketMs);
        }
    }

    return values;
}
