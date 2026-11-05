import type React from "react";

import type { StatsRow } from "../generated/StatsRow";
import { formatBytes } from "../lib/formatting";
import { topCountries } from "../lib/stats-buckets";
import { CountryFlag } from "./country-flag";

const TOP_COUNTRIES_LIMIT = 5;

interface Properties {
    rows: StatsRow[];
}

export const TopCountries: React.FC<Properties> = ({ rows }) => {
    const countries = topCountries(rows, TOP_COUNTRIES_LIMIT);

    return (
        <div className="flex flex-col rounded-lg bg-panel p-4 block-full">
            <h3 className="mbe-2 text-sm font-semibold text-fg-muted">Top countries</h3>

            <div className="grid flex-1 grid-cols-[minmax(0,1fr)_max-content_max-content] content-start gap-x-3 gap-y-1 overflow-y-auto min-block-0">
                {countries.length === 0 && (
                    <p className="col-span-full py-6 text-center text-fg-subtle">No data for selected range</p>
                )}
                {countries.map((entry) => {
                    return (
                        <div
                            className="col-span-full grid grid-cols-subgrid items-center rounded-sm bg-inset px-3 py-2 text-sm"
                            key={entry.country?.code ?? "unknown"}
                        >
                            <span className="truncate">
                                {entry.country === null ? (
                                    <span className="text-fg-muted">Unknown</span>
                                ) : (
                                    <CountryFlag country={entry.country} />
                                )}
                            </span>
                            <span className="text-end text-fg-soft">{entry.connects.toLocaleString()}</span>
                            <span className="text-end text-fg-subtle">{formatBytes(entry.bytes_sent)}</span>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};
