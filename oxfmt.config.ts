import type { OxfmtConfig } from "oxfmt";
import { defineConfig } from "oxfmt";

const config: OxfmtConfig = defineConfig({
    arrowParens: "always",
    bracketSpacing: true,
    jsdoc: true,
    printWidth: 120,
    quoteProps: "as-needed",
    semi: true,
    singleQuote: false,
    sortImports: true,
    sortTailwindcss: {
        stylesheet: "front-end/src/styles/index.css",
    },
    tabWidth: 4,
    trailingComma: "all",
    useTabs: false,
    ignorePatterns: [".local/", ".sqlx/", "CHANGELOG.md", "front-end/src/generated/"],
    overrides: [
        {
            files: ["*.json"],
            options: {
                printWidth: 80,
                trailingComma: "none",
            },
        },
        {
            files: ["*.toml"],
            options: {
                printWidth: 80,
            },
        },
        {
            files: ["*.md", "*.yaml", "*.yml"],
            options: {
                tabWidth: 2,
            },
        },
    ],
});

export default config;
