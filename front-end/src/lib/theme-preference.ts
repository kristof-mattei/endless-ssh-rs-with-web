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

export function applyThemePreference(preference: ThemePreference): void {
    if (preference === "auto") {
        delete document.documentElement.dataset["theme"];
    } else {
        document.documentElement.dataset["theme"] = preference;
    }
}
