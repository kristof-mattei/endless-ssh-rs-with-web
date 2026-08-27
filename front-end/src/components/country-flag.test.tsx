import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CountryFlag } from "./country-flag";

describe("CountryFlag", () => {
    it("renders the regional indicator pair for a country code", { timeout: 1000 }, () => {
        render(<CountryFlag country={{ code: "US", name: "United States" }} />);

        expect(screen.getByText("🇺🇸")).toBeDefined();
        expect(screen.getByText("United States")).toBeDefined();
        expect(screen.getByTitle("United States")).toBeDefined();
    });

    it("uppercases a lowercase code", { timeout: 1000 }, () => {
        render(<CountryFlag country={{ code: "nl", name: "Netherlands" }} />);

        expect(screen.getByText("🇳🇱")).toBeDefined();
    });

    it("renders the code as the label when the name fell back to it", { timeout: 1000 }, () => {
        render(<CountryFlag country={{ code: "DE", name: "DE" }} />);

        expect(screen.getByText("🇩🇪")).toBeDefined();
        expect(screen.getByTitle("DE")).toBeDefined();
    });

    it("renders no flag for a null country", { timeout: 1000 }, () => {
        render(<CountryFlag country={null} />);

        expect(screen.queryByText(/\p{Regional_Indicator}/v)).toBeNull();
    });

    it("renders no flag for a code that is not two characters", { timeout: 1000 }, () => {
        render(<CountryFlag country={{ code: "USA", name: "United States" }} />);

        expect(screen.queryByText(/\p{Regional_Indicator}/v)).toBeNull();
    });
});
