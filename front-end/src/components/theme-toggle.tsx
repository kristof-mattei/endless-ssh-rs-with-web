import type React from "react";

import { setThemePreference, useColorScheme, useThemePreference } from "../hooks/use-theme";
import type { ThemePreference } from "../lib/theme-preference";

const NEXT_PREFERENCE: Record<ThemePreference, ThemePreference> = {
    auto: "light",
    dark: "auto",
    light: "dark",
};

export const ThemeToggle: React.FC = () => {
    const preference = useThemePreference();
    const colorScheme = useColorScheme();

    return (
        <button
            className="fixed inset-e-3 inset-bs-3 cursor-pointer rounded-md border border-line-strong bg-control px-2.5 py-1 text-sm text-fg-soft transition-colors hover:bg-control-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 print:hidden"
            onClick={() => {
                setThemePreference(NEXT_PREFERENCE[preference]);
            }}
            title="Cycle auto, light, dark"
            type="button"
        >
            {preference === "auto" ? `auto (${colorScheme})` : preference}
        </button>
    );
};
