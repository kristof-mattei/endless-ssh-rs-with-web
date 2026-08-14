import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CountryFlag } from "./country-flag";

describe("CountryFlag", () => {
    it("renders the regional indicator pair for a country code", () => {
        render(<CountryFlag countryCode="US" countryName="United States" />);

        expect(screen.getByText("🇺🇸")).toBeDefined();
        expect(screen.getByText("United States")).toBeDefined();
        expect(screen.getByTitle("United States")).toBeDefined();
    });

    it("uppercases a lowercase code", () => {
        render(<CountryFlag countryCode="nl" countryName={null} />);

        expect(screen.getByText("🇳🇱")).toBeDefined();
    });

    it("falls back to the code for the tooltip when the name is missing", () => {
        render(<CountryFlag countryCode="DE" countryName={null} />);

        expect(screen.getByTitle("DE")).toBeDefined();
    });

    it("renders no flag for a null code", () => {
        render(<CountryFlag countryCode={null} countryName="Atlantis" />);

        expect(screen.getByText("Atlantis")).toBeDefined();
        expect(screen.queryByText(/\p{Regional_Indicator}/v)).toBeNull();
    });

    it("renders no flag for a code that is not two characters", () => {
        render(<CountryFlag countryCode="USA" countryName={null} />);

        expect(screen.queryByText(/\p{Regional_Indicator}/v)).toBeNull();
    });
});
