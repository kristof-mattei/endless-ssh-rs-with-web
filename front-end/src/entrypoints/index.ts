// oxlint-disable node/no-top-level-await -- browser entry, `require(esm)` does not apply

if (!("Temporal" in globalThis)) {
    await import("temporal-polyfill/global");
}

// static imports evaluate before this module's code, so a static import of the app would run before the check
await import("./bootstrap");
