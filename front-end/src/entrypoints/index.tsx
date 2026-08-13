import { polyfillCountryFlagEmojis } from "country-flag-emoji-polyfill";
import countryFlagsFontUrl from "country-flag-emoji-polyfill/dist/TwemojiCountryFlags.woff2";
import { setWorkerUrl } from "maplibre-gl";
import maplibreWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "../components/app";
import { useDemoWebSocket } from "../hooks/use-demo-web-socket";
import { useWebSocket } from "../hooks/use-web-sockets";

polyfillCountryFlagEmojis(undefined, countryFlagsFontUrl);
setWorkerUrl(maplibreWorkerUrl);

// ?demo replaces the live WebSocket with locally generated random traffic
const searchParameters = new URLSearchParams(globalThis.location.search);
const useEventSource = searchParameters.has("demo") ? useDemoWebSocket : useWebSocket;

const container = document.querySelector("#root");

// eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- we control the html, the #root will be there
const root = createRoot(container!);

root.render(
    <StrictMode>
        <App useEventSource={useEventSource} />
    </StrictMode>,
);
