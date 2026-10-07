import { Address4, Address6 } from "ip-address";
import prettyBytes from "pretty-bytes";
import type { Temporal } from "temporal-polyfill";

export function formatBytes(bytes: number): string {
    return prettyBytes(bytes);
}

// zero parts below the largest unit are kept, so 86_405 seconds is "1d 0h 0m 5s" and zero is "0s"
export function formatDuration(duration: Temporal.Duration): string {
    const { days, hours, minutes, seconds } = duration.round({
        largestUnit: "days",
        roundingMode: "trunc",
        smallestUnit: "seconds",
    });

    const parts: string[] = [];

    if (days > 0) {
        parts.push(`${days}d`);
    }

    if (parts.length > 0 || hours > 0) {
        parts.push(`${hours}h`);
    }

    if (parts.length > 0 || minutes > 0) {
        parts.push(`${minutes}m`);
    }

    parts.push(`${seconds}s`);

    return parts.join(" ");
}

export function formatIp(ip: string): string {
    // every textual IPv6 form contains a colon, no IPv4 form does
    if (!ip.includes(":")) {
        const parsed = new Address4(ip);

        return parsed.correctForm();
    }

    const parsed = new Address6(ip);

    return parsed.is4() ? parsed.to4().correctForm() : parsed.correctForm();
}
