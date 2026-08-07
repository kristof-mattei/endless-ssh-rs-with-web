import { render, screen } from "@testing-library/react";
import type * as React from "react";
import { describe, expect, it, vi } from "vitest";

import { App } from "./app";

// maplibre requires WebGL, absent in jsdom
vi.mock("react-map-gl/maplibre", () => {
    // eslint-disable-next-line unicorn/consistent-function-scoping -- the factory is hoisted, outer scope is not initialized when it runs
    const Passthrough = ({ children }: { children?: React.ReactNode }): React.JSX.Element => {
        return <div>{children}</div>;
    };

    return { Map: Passthrough, Marker: Passthrough };
});

class InertWebSocket {
    public static readonly CONNECTING = 0;
    public static readonly OPEN = 1;

    public readonly readyState: number = InertWebSocket.CONNECTING;

    // eslint-disable-next-line @typescript-eslint/class-methods-use-this -- stateless stub
    public addEventListener(): void {
        // never connects, never emits
    }

    // eslint-disable-next-line @typescript-eslint/class-methods-use-this -- stateless stub
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
            vi.fn(() => {
                return Promise.race([]);
            }),
        );

        render(<App />);

        expect(screen.getByRole("heading", { level: 1, name: "endless-ssh-rs, an ssh honeypot" })).toBeDefined();
        expect(screen.getByText("connecting")).toBeDefined();
    });
});
