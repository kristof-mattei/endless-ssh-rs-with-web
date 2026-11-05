import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.setConfig({ testTimeout: 1000 });

class FakeMediaQueryList extends EventTarget {
    public matches: boolean;

    public constructor(matches: boolean) {
        super();
        this.matches = matches;
    }
}

function stubPrefersDark(matches: boolean): FakeMediaQueryList {
    const query = new FakeMediaQueryList(matches);

    vi.stubGlobal("matchMedia", () => {
        return query;
    });

    return query;
}

describe("use-theme", () => {
    // the module reads the stored preference once on load, so every test imports a fresh copy
    beforeEach(() => {
        vi.resetModules();
    });

    afterEach(() => {
        localStorage.clear();
        delete document.documentElement.dataset["theme"];
    });

    describe("useThemePreference", () => {
        it("starts from the stored preference", async () => {
            expect.hasAssertions();

            localStorage.setItem("theme", "light");

            const { useThemePreference } = await import("./use-theme");
            const { result } = renderHook(useThemePreference);

            expect(result.current).toBe("light");
        });

        it("treats an unrecognized stored value as auto", async () => {
            expect.hasAssertions();

            localStorage.setItem("theme", "solarized");

            const { useThemePreference } = await import("./use-theme");
            const { result } = renderHook(useThemePreference);

            expect(result.current).toBe("auto");
        });
    });

    describe("useColorScheme", () => {
        it("follows the OS while the preference is auto", async () => {
            expect.hasAssertions();

            const query = stubPrefersDark(true);

            const { useColorScheme } = await import("./use-theme");
            const { result } = renderHook(useColorScheme);

            expect(result.current).toBe("dark");

            act(() => {
                query.matches = false;
                query.dispatchEvent(new Event("change"));
            });

            expect(result.current).toBe("light");
        });

        it("returns an explicit preference over the OS", async () => {
            expect.hasAssertions();

            stubPrefersDark(true);

            const { setThemePreference, useColorScheme } = await import("./use-theme");
            const { result } = renderHook(useColorScheme);

            act(() => {
                setThemePreference("light");
            });

            expect(result.current).toBe("light");
        });
    });
});
