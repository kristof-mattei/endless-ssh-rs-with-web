import { useSyncExternalStore } from "react";

import type { ColorScheme, ThemePreference } from "../lib/theme-preference";
import { applyThemePreference, loadThemePreference, storeThemePreference } from "../lib/theme-preference";

const DARK_QUERY = "(prefers-color-scheme: dark)";

const preferenceListeners = new Set<() => void>();

let currentPreference: ThemePreference = loadThemePreference();

function subscribePreference(onChange: () => void): () => void {
    preferenceListeners.add(onChange);

    return (): void => {
        preferenceListeners.delete(onChange);
    };
}

function getPreference(): ThemePreference {
    return currentPreference;
}

function subscribeSystemScheme(onChange: () => void): () => void {
    const query = globalThis.matchMedia(DARK_QUERY);

    query.addEventListener("change", onChange);

    return (): void => {
        query.removeEventListener("change", onChange);
    };
}

function getSystemScheme(): ColorScheme {
    return globalThis.matchMedia(DARK_QUERY).matches ? "dark" : "light";
}

export function setThemePreference(preference: ThemePreference): void {
    storeThemePreference(preference);
    applyThemePreference(preference);

    currentPreference = preference;

    for (const listener of preferenceListeners) {
        listener();
    }
}

export function useThemePreference(): ThemePreference {
    return useSyncExternalStore(subscribePreference, getPreference);
}

export function useColorScheme(): ColorScheme {
    const preference = useThemePreference();
    const systemScheme = useSyncExternalStore(subscribeSystemScheme, getSystemScheme);

    return preference === "auto" ? systemScheme : preference;
}
