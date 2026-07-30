import { Address4, Address6 } from "ip-address";
import prettyBytes from "pretty-bytes";

export function formatBytes(bytes: number): string {
    return prettyBytes(bytes);
}

export function formatDuration(seconds: number): string {
    const d = Math.floor(seconds / 86_400);
    const h = Math.floor((seconds % 86_400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);

    const parts: string[] = [];

    // eslint-disable-next-line unicorn/consistent-boolean-name -- doesn't make sense here
    let hitNoneZero = false;

    if (d > 0) {
        parts.push(`${d.toString()}d`);
        hitNoneZero = true;
    }

    if (hitNoneZero || h > 0) {
        parts.push(`${h.toString()}h`);
        hitNoneZero = true;
    }

    if (hitNoneZero || m > 0) {
        parts.push(`${m.toString()}m`);
    }

    parts.push(`${s.toString()}s`);
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
