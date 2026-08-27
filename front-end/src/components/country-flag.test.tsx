import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CountryFlag } from "./country-flag";

vi.setConfig({ testTimeout: 1000 });

describe("CountryFlag", () => {
    it("renders the regional indicator pair for a country code", () => {
        render(<CountryFlag country={{ code: "US", name: "United States" }} />);

        expect(screen.getByText("🇺🇸")).toBeDefined();
        expect(screen.getByText("United States")).toBeDefined();
        expect(screen.getByTitle("United States")).toBeDefined();
    });

    it("uppercases a lowercase code", () => {
        render(<CountryFlag country={{ code: "nl", name: "Netherlands" }} />);

        expect(screen.getByText("🇳🇱")).toBeDefined();
    });

    it("renders the code as the label when the name fell back to it", () => {
        render(<CountryFlag country={{ code: "DE", name: "DE" }} />);

        expect(screen.getByText("🇩🇪")).toBeDefined();
        expect(screen.getByTitle("DE")).toBeDefined();
    });

    it("renders no flag for a null country", () => {
        render(<CountryFlag country={null} />);

        expect(screen.queryByText(/\p{Regional_Indicator}/v)).toBeNull();
    });

    it("renders no flag for a code that is not two characters", () => {
        render(<CountryFlag country={{ code: "USA", name: "United States" }} />);

        expect(screen.queryByText(/\p{Regional_Indicator}/v)).toBeNull();
    });
});
