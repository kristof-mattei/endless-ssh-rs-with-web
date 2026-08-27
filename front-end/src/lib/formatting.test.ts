import { describe, expect, it } from "vitest";

import { formatDuration, formatIp } from "./formatting";

describe("formatDuration", () => {
    it("renders bare seconds", { timeout: 1000 }, () => {
        expect.assertions(2);

        expect(formatDuration(0)).toBe("0s");
        expect(formatDuration(59)).toBe("59s");
    });

    it("floors fractional seconds", { timeout: 1000 }, () => {
        expect.assertions(1);

        expect(formatDuration(59.9)).toBe("59s");
    });

    it("renders minutes with seconds", { timeout: 1000 }, () => {
        expect.assertions(2);

        expect(formatDuration(60)).toBe("1m 0s");
        expect(formatDuration(125)).toBe("2m 5s");
    });

    it("renders hours with all smaller units", { timeout: 1000 }, () => {
        expect.assertions(2);

        expect(formatDuration(3600)).toBe("1h 0m 0s");
        expect(formatDuration(3661)).toBe("1h 1m 1s");
    });

    it("keeps zero units below the largest nonzero unit", { timeout: 1000 }, () => {
        expect.assertions(2);

        expect(formatDuration(86_400)).toBe("1d 0h 0m 0s");
        expect(formatDuration(86_400 + 5)).toBe("1d 0h 0m 5s");
    });

    it("renders a fully populated duration", { timeout: 1000 }, () => {
        expect.assertions(1);

        expect(formatDuration(90_061)).toBe("1d 1h 1m 1s");
    });
});

describe("formatIp", () => {
    it("renders IPv4 as a dotted quad", { timeout: 1000 }, () => {
        expect.assertions(1);

        expect(formatIp("203.0.113.9")).toBe("203.0.113.9");
    });

    it("unwraps IPv4 mapped in IPv6", { timeout: 1000 }, () => {
        expect.assertions(1);

        expect(formatIp("::ffff:198.51.100.7")).toBe("198.51.100.7");
    });

    it("renders IPv6 in canonical form", { timeout: 1000 }, () => {
        expect.assertions(2);

        expect(formatIp("2001:db8::1")).toBe("2001:db8::1");
        expect(formatIp("2001:0db8:0000:0000:0000:0000:0000:0001")).toBe("2001:db8::1");
    });

    it("throws on garbage", { timeout: 1000 }, () => {
        expect.assertions(2);

        expect(() => {
            return formatIp("not-an-ip");
        }).toThrow();
        expect(() => {
            return formatIp("zz::gg");
        }).toThrow();
    });
});
