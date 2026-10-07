import { fireEvent, render, screen } from "@testing-library/react";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import type React from "react";
import { describe, expect, it, onTestFinished, vi } from "vitest";

import { App } from "./app";

vi.setConfig({ testTimeout: 1000 });

const map = vi.hoisted(() => {
    return { fails: false };
});

// maplibre requires WebGL, absent in jsdom
vi.mock("react-map-gl/maplibre", () => {
    // oxlint-disable-next-line unicorn/consistent-function-scoping -- the factory is hoisted, outer scope is not initialized when it runs
    const Passthrough = ({ children }: { children?: React.ReactNode }): React.JSX.Element => {
        if (map.fails) {
            throw new Error("WebGL context lost");
        }

        return <div>{children}</div>;
    };

    return { Map: Passthrough, Marker: Passthrough };
});

class InertWebSocket {
    public static readonly CONNECTING = 0;
    public static readonly OPEN = 1;

    public readonly readyState: number = InertWebSocket.CONNECTING;

    // oxlint-disable-next-line typescript/class-methods-use-this -- stateless stub
    public addEventListener(): void {
        // never connects, never emits
    }

    // oxlint-disable-next-line typescript/class-methods-use-this -- stateless stub
    public close(): void {
        // nothing to close
    }
}

describe("App", () => {
    it("renders", () => {
        vi.stubGlobal("WebSocket", InertWebSocket);
        // a forever-pending stats fetch, the test only covers first paint
        vi.stubGlobal(
            "fetch",
            vi.fn(async () => {
                await Promise.race([]);
            }),
        );

        render(<App />, { wrapper: NuqsTestingAdapter });

        expect(screen.getByRole("heading", { level: 1, name: "endless-ssh-rs, an ssh honeypot" })).toBeDefined();
        expect(screen.getByText("connecting")).toBeDefined();
    });

    it("keeps the other sections when one fails to render, and retries it", () => {
        vi.stubGlobal("WebSocket", InertWebSocket);
        vi.stubGlobal(
            "fetch",
            vi.fn(async () => {
                await Promise.race([]);
            }),
        );
        // React reports every caught render error on the console
        vi.spyOn(console, "error").mockReturnValue();

        map.fails = true;
        onTestFinished(() => {
            map.fails = false;
        });

        render(<App />, { wrapper: NuqsTestingAdapter });

        expect(screen.getByRole("alert").textContent).toContain("Failed to render this section: WebGL context lost.");
        expect(screen.getByText("Total connections")).toBeDefined();

        map.fails = false;
        fireEvent.click(screen.getByRole("button", { name: "Retry" }));

        expect(screen.queryByRole("alert")).toBeNull();
    });
});
