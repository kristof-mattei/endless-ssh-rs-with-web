import type React from "react";

import type { StatsRow } from "../generated/StatsRow";
import { formatBytes } from "../lib/formatting";
import { topCountries } from "../lib/stats-buckets";
import { CountryFlag } from "./country-flag";

const TOP_COUNTRIES_LIMIT = 5;

const REGION_NAMES = new Intl.DisplayNames([], { type: "region" });

function countryName(code: null | string): null | string {
    if (code === null) {
        return null;
    }

    const name = ((): string | undefined => {
        try {
            return REGION_NAMES.of(code);
        } catch {
            return undefined;
        }
    })();

    return name ?? code;
}

interface Properties {
    rows: StatsRow[];
}

export const TopCountries: React.FC<Properties> = ({ rows }) => {
    const countries = topCountries(rows, TOP_COUNTRIES_LIMIT);

    return (
        <div className="flex flex-col rounded-lg bg-gray-800 p-4 block-full">
            <h3 className="mbe-2 text-sm font-semibold text-gray-400">Top countries</h3>

            <div className="grid flex-1 grid-cols-[minmax(0,1fr)_max-content_max-content] content-start gap-x-3 gap-y-1 overflow-y-auto min-block-0">
                {countries.length === 0 && (
                    <p className="col-span-full py-6 text-center text-gray-500">No data for selected range</p>
                )}
                {countries.map((country) => {
                    return (
                        <div
                            className="col-span-full grid grid-cols-subgrid items-center rounded-sm bg-gray-900 px-3 py-2 text-sm"
                            key={country.country_code ?? "unknown"}
                        >
                            <span className="truncate">
                                {country.country_code === null ? (
                                    <span className="text-gray-400">Unknown</span>
                                ) : (
                                    <CountryFlag
                                        countryCode={country.country_code}
                                        countryName={countryName(country.country_code)}
                                    />
                                )}
                            </span>
                            <span className="text-end text-gray-300">{country.connects.toLocaleString()}</span>
                            <span className="text-end text-gray-500">{formatBytes(country.bytes_sent)}</span>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};
