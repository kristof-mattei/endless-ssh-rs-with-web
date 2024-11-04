import { createRoot } from "react-dom/client";

import { App } from "@/components/app";

const container = document.querySelector("#root");

// eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- we control the html, the #root will be there
const root = createRoot(container!);

root.render(<App />);
