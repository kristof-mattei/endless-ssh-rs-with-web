import { Temporal } from "temporal-polyfill";
import { describe, expect, it, vi } from "vitest";

import { parseStatsResponse, parseWsEvent } from "./wire";

vi.setConfig({ testTimeout: 1000 });

const DISCONNECTED =
    '{"type":"disconnected","sequence":1,"ip":"192.0.2.1","port":50000,"connected_at":{"$instant":"2026-01-01T00:00:00Z"},"disconnected_at":{"$instant":"2026-01-01T00:00:00.184Z"},"time_spent":60,"bytes_sent":100,"country":null,"city":"2026-01-01T00:00:00Z","coordinates":null}';

describe("parseWsEvent", () => {
    // the wrappers are what the back-end's `Timestamp` test asserts it writes, see `utils/serde.rs`
    it("turns the back-end's `$instant` wrappers into instants", () => {
        const event = parseWsEvent(DISCONNECTED);

        if (event.type !== "disconnected") {
            throw new Error("unreachable, the frame is a disconnect");
        }

        expect(event.connected_at).toBeInstanceOf(Temporal.Instant);
        expect(event.connected_at.epochMilliseconds).toBe(1_767_225_600_000);
        expect(event.disconnected_at.epochMilliseconds).toBe(1_767_225_600_184);
    });

    it("leaves a bare string alone even when it looks like a timestamp", () => {
        const event = parseWsEvent(DISCONNECTED);

        expect(event).toMatchObject({ city: "2026-01-01T00:00:00Z" });
    });

    it("finds wrappers inside the init payload's array", () => {
        const event = parseWsEvent(
            '{"type":"init","build_id":"dev","active_connections":[{"ip":"::1","port":1,"connected_at":{"$instant":"2026-01-01T00:00:00Z"},"bytes_sent":0,"coordinates":null,"country":null,"city":null}],"total_connections":0,"total_bytes_sent":0,"total_time_spent":0,"last_counted_id":0}',
        );

        if (event.type !== "init") {
            throw new Error("unreachable, the frame is an init");
        }

        expect(event.active_connections[0]?.connected_at).toBeInstanceOf(Temporal.Instant);
    });

    it("throws on a wrapper whose value is not a timestamp", () => {
        expect(() => {
            return parseWsEvent(DISCONNECTED.replace('"2026-01-01T00:00:00Z"}', '"yesterday"}'));
        }).toThrow();
    });
});

describe("parseStatsResponse", () => {
    it("turns every row's bucket into an instant", () => {
        const stats = parseStatsResponse(
            '{"bucket_seconds":60,"rows":[{"bucket":{"$instant":"2026-01-01T00:00:00Z"},"country":null,"connects":1,"time_spent":1,"bytes_sent":1},{"bucket":{"$instant":"2026-01-01T00:01:00Z"},"country":{"code":"NL","name":"Netherlands"},"connects":2,"time_spent":2,"bytes_sent":2}]}',
        );

        expect(
            stats.rows.map((row) => {
                return row.bucket.epochMilliseconds;
            }),
        ).toEqual([1_767_225_600_000, 1_767_225_660_000]);
    });
});
