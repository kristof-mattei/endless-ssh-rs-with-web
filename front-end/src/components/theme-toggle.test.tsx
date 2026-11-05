import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ThemeToggle } from "./theme-toggle";

vi.setConfig({ testTimeout: 1000 });

// jsdom does not implement matchMedia
class DarkMediaQueryList extends EventTarget {
    public readonly matches: boolean = true;
}

describe("ThemeToggle", () => {
    it("cycles auto, light, dark and back to auto", () => {
        vi.stubGlobal("matchMedia", () => {
            return new DarkMediaQueryList();
        });

        render(<ThemeToggle />);

        const toggle = screen.getByRole("button", { name: "auto (dark)" });

        fireEvent.click(toggle);

        expect(toggle.textContent).toBe("light");
        expect(localStorage.getItem("theme")).toBe("light");
        expect(document.documentElement.dataset["theme"]).toBe("light");

        fireEvent.click(toggle);

        expect(toggle.textContent).toBe("dark");
        expect(localStorage.getItem("theme")).toBe("dark");
        expect(document.documentElement.dataset["theme"]).toBe("dark");

        fireEvent.click(toggle);

        expect(toggle.textContent).toBe("auto (dark)");
        expect(localStorage.getItem("theme")).toBeNull();
        expect(document.documentElement.dataset["theme"]).toBeUndefined();
    });
});
