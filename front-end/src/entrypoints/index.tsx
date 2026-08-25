import { polyfillCountryFlagEmojis } from "country-flag-emoji-polyfill";
import countryFlagsFontUrl from "country-flag-emoji-polyfill/dist/TwemojiCountryFlags.woff2";
import { setWorkerUrl } from "maplibre-gl";
import maplibreWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import { NuqsAdapter } from "nuqs/adapters/react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "../components/app";

polyfillCountryFlagEmojis(undefined, countryFlagsFontUrl);
setWorkerUrl(maplibreWorkerUrl);

const container = document.querySelector("#root");

// oxlint-disable-next-line typescript/no-non-null-assertion -- we control the html, the #root will be there
const root = createRoot(container!);

root.render(
    <StrictMode>
        <NuqsAdapter>
            <App />
        </NuqsAdapter>
    </StrictMode>,
);
