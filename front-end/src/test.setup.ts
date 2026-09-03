import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// jsdom does no layout, so it implements no SVG measurement. The chart sizes its axes by measuring them, and
// throws without this: https://github.com/jsdom/jsdom/issues/3159. Everything measures as empty.
SVGGraphicsElement.prototype.getBBox = (): DOMRect => {
    return new DOMRect(0, 0, 0, 0);
};

afterEach(() => {
    cleanup();
});
