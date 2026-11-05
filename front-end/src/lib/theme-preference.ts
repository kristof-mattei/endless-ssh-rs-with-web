const STORAGE_KEY = "theme";

export type ColorScheme = "dark" | "light";

export type ThemePreference = "auto" | ColorScheme;

export function loadThemePreference(): ThemePreference {
    try {
        const stored = localStorage.getItem(STORAGE_KEY);

        return stored === "dark" || stored === "light" ? stored : "auto";
    } catch {
        // storage is disabled
        return "auto";
    }
}

export function storeThemePreference(preference: ThemePreference): void {
    try {
        if (preference === "auto") {
            localStorage.removeItem(STORAGE_KEY);
        } else {
            localStorage.setItem(STORAGE_KEY, preference);
        }
    } catch {
        // storage is disabled, the preference is not persisted
    }
}

export function subscribeStoredThemePreference(onChange: (preference: ThemePreference) => void): () => void {
    function onStorage(event: StorageEvent): void {
        // `localStorage.clear()` fires with a `null` key
        if (event.key === STORAGE_KEY || event.key === null) {
            onChange(loadThemePreference());
        }
    }

    globalThis.addEventListener("storage", onStorage);

    return (): void => {
        globalThis.removeEventListener("storage", onStorage);
    };
}

export function applyThemePreference(preference: ThemePreference): void {
    if (preference === "auto") {
        delete document.documentElement.dataset["theme"];
    } else {
        document.documentElement.dataset["theme"] = preference;
    }
}
