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

        it("follows a preference stored by another tab", async () => {
            expect.hasAssertions();

            const { useThemePreference } = await import("./use-theme");
            const { result } = renderHook(useThemePreference);

            act(() => {
                localStorage.setItem("theme", "dark");
                globalThis.dispatchEvent(new StorageEvent("storage", { key: "theme", newValue: "dark" }));
            });

            expect(result.current).toBe("dark");
            expect(document.documentElement.dataset["theme"]).toBe("dark");
        });

        it("resets to auto when another tab clears storage", async () => {
            expect.hasAssertions();

            localStorage.setItem("theme", "light");
            document.documentElement.dataset["theme"] = "light";

            const { useThemePreference } = await import("./use-theme");
            const { result } = renderHook(useThemePreference);

            act(() => {
                localStorage.clear();
                globalThis.dispatchEvent(new StorageEvent("storage", { key: null }));
            });

            expect(result.current).toBe("auto");
            expect(document.documentElement.dataset["theme"]).toBeUndefined();
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
