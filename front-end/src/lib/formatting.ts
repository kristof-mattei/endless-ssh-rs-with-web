import prettyBytes from "pretty-bytes";

export function formatBytes(bytes: number): string {
    return prettyBytes(bytes);
}

export function formatDuration(secs: number): string {
    const d = Math.floor(secs / 86_400);
    const h = Math.floor((secs % 86_400) / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = Math.floor(secs % 60);

    const parts: string[] = [];
    let hitNoneZero = false;

    if (d > 0) {
        parts.push(`${d.toString()}d`);
        hitNoneZero = true;
    }

    if (h > 0 || hitNoneZero) {
        parts.push(`${h.toString()}h`);
        hitNoneZero = true;
    }

    if (m > 0 || hitNoneZero) {
        parts.push(`${m.toString()}m`);
    }

    parts.push(`${s.toString()}s`);
    return parts.join(" ");
}
