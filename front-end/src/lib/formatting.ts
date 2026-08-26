import { Address4, Address6 } from "ip-address";
import prettyBytes from "pretty-bytes";
import { Temporal } from "temporal-polyfill";

export function formatBytes(bytes: number): string {
    return prettyBytes(bytes);
}

// zero parts below the largest unit are kept, so 86_405 is "1d 0h 0m 5s" and 0 is "0s"
export function formatDuration(totalSeconds: number): string {
    const { days, hours, minutes, seconds } = Temporal.Duration.from({ seconds: Math.floor(totalSeconds) }).round({
        largestUnit: "days",
    });

    const parts: string[] = [];

    if (days > 0) {
        parts.push(`${days.toString()}d`);
    }

    if (parts.length > 0 || hours > 0) {
        parts.push(`${hours.toString()}h`);
    }

    if (parts.length > 0 || minutes > 0) {
        parts.push(`${minutes.toString()}m`);
    }

    parts.push(`${seconds.toString()}s`);

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
