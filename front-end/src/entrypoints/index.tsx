import { polyfillCountryFlagEmojis } from "country-flag-emoji-polyfill";
import { setWorkerUrl } from "maplibre-gl";
import maplibreWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "../components/app";

polyfillCountryFlagEmojis();
setWorkerUrl(maplibreWorkerUrl);

const container = document.querySelector("#root");

// eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- we control the html, the #root will be there
const root = createRoot(container!);

root.render(
    <StrictMode>
        <App />
    </StrictMode>,
);
