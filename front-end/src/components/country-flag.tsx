import type * as React from "react";

interface Properties {
    countryCode: null | string;
    countryName: null | string;
}

function countryFlag(code: null | string): null | string {
    if (code?.length !== 2) {
        return null;
    }

    // prettier-ignore
    const base = 0x01_F1_E6;
    const upper = code.toUpperCase();
    const cp0 = upper.codePointAt(0);
    const cp1 = upper.codePointAt(1);

    if (cp0 === undefined || cp1 === undefined) {
        return null;
    }
    return String.fromCodePoint(base + cp0 - 65) + String.fromCodePoint(base + cp1 - 65);
}

export const CountryFlag: React.FC<Properties> = ({ countryCode, countryName }) => {
    return (
        <span className="cursor-default flags-font text-lg" title={countryName ?? countryCode ?? undefined}>
            {countryFlag(countryCode)}
        </span>
    );
};
