import { useEffect } from "react";
import { Temporal } from "temporal-polyfill";

import type { WsEvent } from "../generated/WsEvent";

interface Options {
    onEvent: (event: WsEvent) => void;
}

interface DemoLocation {
    city: string;
    country_code: string;
    country_name: string;
    latitude: number;
    longitude: number;
}

const LOCATIONS: DemoLocation[] = [
    { city: "Shanghai", country_code: "CN", country_name: "China", latitude: 31.23, longitude: 121.47 },
    { city: "Beijing", country_code: "CN", country_name: "China", latitude: 39.9, longitude: 116.41 },
    { city: "Moscow", country_code: "RU", country_name: "Russia", latitude: 55.76, longitude: 37.62 },
    { city: "Amsterdam", country_code: "NL", country_name: "Netherlands", latitude: 52.37, longitude: 4.9 },
    { city: "Frankfurt", country_code: "DE", country_name: "Germany", latitude: 50.11, longitude: 8.68 },
    { city: "London", country_code: "GB", country_name: "United Kingdom", latitude: 51.51, longitude: -0.13 },
    { city: "New York", country_code: "US", country_name: "United States", latitude: 40.71, longitude: -74.01 },
    { city: "Los Angeles", country_code: "US", country_name: "United States", latitude: 34.05, longitude: -118.24 },
    { city: "São Paulo", country_code: "BR", country_name: "Brazil", latitude: -23.55, longitude: -46.63 },
    { city: "Mumbai", country_code: "IN", country_name: "India", latitude: 19.08, longitude: 72.88 },
    { city: "Singapore", country_code: "SG", country_name: "Singapore", latitude: 1.35, longitude: 103.82 },
    { city: "Seoul", country_code: "KR", country_name: "South Korea", latitude: 37.57, longitude: 126.98 },
    { city: "Tokyo", country_code: "JP", country_name: "Japan", latitude: 35.68, longitude: 139.65 },
    { city: "Sydney", country_code: "AU", country_name: "Australia", latitude: -33.87, longitude: 151.21 },
    { city: "Hanoi", country_code: "VN", country_name: "Vietnam", latitude: 21.03, longitude: 105.85 },
];

const SPAWN_MIN_MS = 500;
const SPAWN_MAX_MS = 3000;
const LIFETIME_MIN_MS = 5000;
const LIFETIME_MAX_MS = 60_000;

function randomInt(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomIp(): string {
    if (Math.random() < 0.2) {
        const groups = Array.from({ length: 8 }, () => {
            return randomInt(0, 0xff_ff).toString(16);
        });

        return groups.join(":");
    }

    return `${randomInt(1, 223).toString()}.${randomInt(0, 255).toString()}.${randomInt(0, 255).toString()}.${randomInt(1, 254).toString()}`;
}

// spread markers from the same city so they don't stack on one pixel
function jitter(coordinate: number): number {
    return coordinate + (Math.random() - 0.5) * 1.5;
}

export function useDemoWebSocket({ onEvent }: Options): { status: "demo" } {
    useEffect(() => {
        let sequence = 0;
        const timers = new Set<ReturnType<typeof setTimeout>>();

        function schedule(ms: number, callback: () => void): void {
            const id = setTimeout(() => {
                timers.delete(id);
                callback();
            }, ms);

            timers.add(id);
        }

        function spawn(): void {
            // a tenth of connections get no geolocation, like a failed lookup
            const location = Math.random() < 0.1 ? undefined : LOCATIONS[randomInt(0, LOCATIONS.length - 1)];

            const geo = {
                country_code: location?.country_code ?? null,
                country_name: location?.country_name ?? null,
                city: location?.city ?? null,
                latitude: location === undefined ? null : jitter(location.latitude),
                longitude: location === undefined ? null : jitter(location.longitude),
            };

            const ip = randomIp();
            const port = randomInt(1024, 65_535);
            const connectedAt = Temporal.Now.instant();

            onEvent({
                type: "connected",
                ip,
                port,
                connected_at: connectedAt.toString(),
                ...geo,
            });

            schedule(randomInt(LIFETIME_MIN_MS, LIFETIME_MAX_MS), () => {
                const disconnectedAt = Temporal.Now.instant();
                const timeSpent = Math.round((disconnectedAt.epochMilliseconds - connectedAt.epochMilliseconds) / 1000);

                sequence += 1;

                onEvent({
                    type: "disconnected",
                    sequence,
                    ip,
                    port,
                    connected_at: connectedAt.toString(),
                    disconnected_at: disconnectedAt.toString(),
                    time_spent: timeSpent,
                    bytes_sent: randomInt(2, 8) * timeSpent,
                    ...geo,
                });
            });

            schedule(randomInt(SPAWN_MIN_MS, SPAWN_MAX_MS), spawn);
        }

        onEvent({
            type: "init",
            active_connections: [],
            total_connections: 0,
            total_bytes_sent: 0,
            total_time_spent: 0,
            last_counted_id: 0,
        });

        spawn();

        return () => {
            for (const id of timers) {
                clearTimeout(id);
            }
        };
    }, [onEvent]);

    return { status: "demo" };
}
