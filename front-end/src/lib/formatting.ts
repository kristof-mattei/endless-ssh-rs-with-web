import { Address4, Address6 } from "ip-address";
import prettyBytes from "pretty-bytes";

export function formatBytes(bytes: number): string {
    return prettyBytes(bytes);
}

export function formatDuration(totalSeconds: number): string {
    const days = Math.floor(totalSeconds / 86_400);
    const hours = Math.floor((totalSeconds % 86_400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = Math.floor(totalSeconds % 60);

    const parts: string[] = [];

    let hitNoneZero = false;

    if (days > 0) {
        parts.push(`${days.toString()}d`);
        hitNoneZero = true;
    }

    if (hitNoneZero || hours > 0) {
        parts.push(`${hours.toString()}h`);
        hitNoneZero = true;
    }

    if (hitNoneZero || minutes > 0) {
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
