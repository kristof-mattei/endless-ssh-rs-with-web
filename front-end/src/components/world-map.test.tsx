import { act, render, screen } from "@testing-library/react";
import type React from "react";
import { describe, expect, it, vi } from "vitest";

import { WorldMap } from "./world-map";

vi.setConfig({ testTimeout: 1000 });

// maplibre requires WebGL, absent in jsdom
vi.mock("react-map-gl/maplibre", () => {
    // oxlint-disable-next-line unicorn/consistent-function-scoping -- the factory is hoisted, outer scope is not initialized when it runs
    const Map = ({ children, mapStyle }: { children?: React.ReactNode; mapStyle: string }): React.JSX.Element => {
        return (
            <div data-map-style={mapStyle} data-testid="map">
                {children}
            </div>
        );
    };

    return {
        Map,
        Marker: (): null => {
            return null;
        },
    };
});

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

function renderedMapStyle(): string | undefined {
    return screen.getByTestId("map").dataset["mapStyle"];
}

describe("WorldMap", () => {
    it("uses the positron basemap when the OS prefers light", () => {
        stubPrefersDark(false);

        render(<WorldMap activeConnections={[]} />);

        expect(renderedMapStyle()).toBe("https://basemaps.cartocdn.com/gl/positron-gl-style/style.json");
    });

    it("switches from dark-matter to positron when the OS preference changes", () => {
        const query = stubPrefersDark(true);

        render(<WorldMap activeConnections={[]} />);

        expect(renderedMapStyle()).toBe("https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json");

        act(() => {
            query.matches = false;
            query.dispatchEvent(new Event("change"));
        });

        expect(renderedMapStyle()).toBe("https://basemaps.cartocdn.com/gl/positron-gl-style/style.json");
    });
});
