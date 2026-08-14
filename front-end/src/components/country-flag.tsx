import type React from "react";

import type { Country } from "../generated/Country";

interface Properties {
    country: Country | null;
}

function countryFlag(code: string): null | string {
    if (code.length !== 2) {
        return null;
    }

    // oxfmt would lowercase these digits, unicorn/number-literal-case requires uppercase
    // oxfmt-ignore
    const base = 0x01_F1_E6;
    const upper = code.toUpperCase();
    const cp0 = upper.codePointAt(0);
    const cp1 = upper.codePointAt(1);

    if (cp0 === undefined || cp1 === undefined) {
        return null;
    }
    return String.fromCodePoint(base + cp0 - 65) + String.fromCodePoint(base + cp1 - 65);
}

export const CountryFlag: React.FC<Properties> = ({ country }) => {
    return (
        <span className="cursor-default" title={country?.name}>
            <span className="flags-font text-lg">{country === null ? null : countryFlag(country.code)}</span>
            {country !== null && <span className="ms-1.5 text-gray-400">{country.name}</span>}
        </span>
    );
};
