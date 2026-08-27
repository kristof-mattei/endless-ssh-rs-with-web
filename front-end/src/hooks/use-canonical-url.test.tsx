import { render, waitFor } from "@testing-library/react";
import type { UrlUpdateEvent } from "nuqs/adapters/testing";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import type React from "react";
import { describe, expect, it, vi } from "vitest";

import { useCanonicalUrl } from "./use-canonical-url";

vi.setConfig({ testTimeout: 1000 });

const Probe: React.FC = () => {
    useCanonicalUrl();

    return null;
};

// resolves with the single URL update the hook performs on mount
async function renderAndCaptureUpdate(searchParams: string): Promise<UrlUpdateEvent> {
    const updates: UrlUpdateEvent[] = [];

    render(
        <NuqsTestingAdapter
            onUrlUpdate={(event) => {
                updates.push(event);
            }}
            searchParams={searchParams}
        >
            <Probe />
        </NuqsTestingAdapter>,
    );

    await waitFor(() => {
        expect(updates).toHaveLength(1);
    });

    const [update] = updates;

    if (update === undefined) {
        throw new Error("unreachable, the waitFor above establishes the entry");
    }

    return update;
}

describe("useCanonicalUrl", () => {
    it("writes every param on mount, defaults included", async () => {
        expect.hasAssertions();

        const { searchParams } = await renderAndCaptureUpdate("");

        expect(searchParams.get("range")).toBe("24-hours");
        expect(searchParams.get("metric")).toBe("connections");
        expect(searchParams.get("refresh")).toBe("off");
    });

    it("replaces rather than pushing, so arriving leaves no history entry to step back into", async () => {
        expect.hasAssertions();

        const { options } = await renderAndCaptureUpdate("");

        expect(options.history).toBe("replace");
    });

    it("keeps values the URL already carries and fills in only the rest", async () => {
        expect.hasAssertions();

        const { searchParams } = await renderAndCaptureUpdate("?range=7-days&refresh=10s");

        expect(searchParams.get("range")).toBe("7-days");
        expect(searchParams.get("refresh")).toBe("10s");
        expect(searchParams.get("metric")).toBe("connections");
    });

    it("ignores a value it cannot parse and writes the default in its place", async () => {
        expect.hasAssertions();

        const { searchParams } = await renderAndCaptureUpdate("?metric=bogus");

        expect(searchParams.get("metric")).toBe("connections");
    });
});
