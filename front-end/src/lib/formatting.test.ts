import { describe, expect, it } from "vitest";

import { formatIp } from "./formatting";

describe("formatIp", () => {
    it("renders IPv4 as a dotted quad", () => {
        expect(formatIp("203.0.113.9")).toBe("203.0.113.9");
    });

    it("unwraps IPv4 mapped in IPv6", () => {
        expect(formatIp("::ffff:198.51.100.7")).toBe("198.51.100.7");
    });

    it("renders IPv6 in canonical form", () => {
        expect(formatIp("2001:db8::1")).toBe("2001:db8::1");
        expect(formatIp("2001:0db8:0000:0000:0000:0000:0000:0001")).toBe("2001:db8::1");
    });

    it("throws on garbage", () => {
        expect(() => {
            return formatIp("not-an-ip");
        }).toThrow();
        expect(() => {
            return formatIp("zz::gg");
        }).toThrow();
    });
});
