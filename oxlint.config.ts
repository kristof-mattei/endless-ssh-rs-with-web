import type { OxlintConfig } from "oxlint";
import { defineConfig } from "oxlint";

const plugins = [
    "eslint",
    "import",
    "jsdoc",
    "jsx-a11y",
    "node",
    "oxc",
    "promise",
    "react",
    "react-perf",
    "typescript",
    "unicorn",
] satisfies NonNullable<OxlintConfig["plugins"]>;

const config: OxlintConfig = defineConfig({
    plugins,
    jsPlugins: [
        "./oxlint.plugin.ts",
        "eslint-plugin-better-tailwindcss",
        {
            name: "n",
            specifier: "eslint-plugin-n",
        },
        "eslint-plugin-perfectionist",
        "eslint-plugin-react-hook-form",
    ],
    categories: {
        correctness: "error",
        nursery: "off",
        pedantic: "error",
        perf: "error",
        restriction: "error",
        style: "error",
        suspicious: "error",
    },
    options: {
        denyWarnings: true,
        reportUnusedDisableDirectives: "error",
        typeAware: true,
        typeCheck: true,
    },
    env: {
        browser: true,
        es2026: true,
    },
    settings: {
        "better-tailwindcss": {
            entryPoint: "front-end/src/styles/index.css",
        },
    },
    ignorePatterns: [
        "dist/",
        "coverage/",
        "reports/",
        "target/",
        ".local/",
        ".pnpm-store/",
        "front-end/src/generated/",
    ],
    rules: {
        "arrow-body-style": ["error", "always"],
        "capitalized-comments": "off",
        curly: ["error", "all"],
        // a default arm would silence typescript/switch-exhaustiveness-check
        "default-case": "off",
        eqeqeq: ["error", "always"],
        "func-style": ["error", "declaration", { allowArrowFunctions: true }],
        "id-length": ["error", { exceptions: ["x", "y"] }],
        "max-lines": "off",
        "max-lines-per-function": "off",
        "max-params": "error",
        "max-statements": "off",
        "no-alert": "error",
        "no-console": ["error", { allow: ["error", "warn"] }],
        "no-duplicate-imports": ["error", { allowSeparateTypeImports: true }],
        "no-inline-comments": "off",
        // tsc reports redeclarations (ts2451); this rule also flags a type and a value sharing a name, which TypeScript allows
        "no-redeclare": "off",
        "no-ternary": "off",
        "no-undefined": "off",
        "no-unreachable-loop": "error",
        "no-warning-comments": "error",
        "one-var": ["error", "never"],
        // destructuring a later array index needs a hole in the pattern (`const [, second] = ...`)
        "prefer-destructuring": ["error", { array: false, object: true }],
        "require-await": "off",
        // perfectionist/sort-named-imports orders the members
        "sort-imports": "off",
        "sort-keys": "off",
        "no-restricted-globals": [
            "error",
            {
                message: "Use Temporal from temporal-polyfill instead.",
                name: "Date",
            },
            {
                message: "Import Temporal from temporal-polyfill instead.",
                name: "Temporal",
            },
        ],
        "no-shadow": "error",
        "no-use-before-define": "error",
        "no-useless-assignment": "error",
        "no-useless-constructor": "error",
        "no-void": ["error", { allowAsStatement: true }],
        "object-shorthand": ["error", "always"],
        "prefer-template": "error",

        "oxc/no-async-await": "off",
        "oxc/no-optional-chaining": "off",
        "oxc/no-rest-spread-properties": "off",

        "unicorn/no-array-sort": "error",
        "unicorn/no-null": "off",
        "unicorn/no-useless-iterator-to-array": "error",
        "unicorn/prefer-ternary": "off",

        "import/export": "error",
        "import/extensions": [
            "error",
            "ignorePackages",
            {
                json: "always",
                ts: "never",
                tsx: "never",
            },
        ],
        "import/exports-last": "off",
        "import/group-exports": "off",
        "import/named": "error",
        "import/newline-after-import": "error",
        "import/no-cycle": "off",
        "import/no-default-export": "error",
        "import/no-named-export": "off",
        "import/no-relative-parent-imports": "off",
        "import/no-unassigned-import": ["error", { allow: ["**/*.css"] }],
        "import/prefer-default-export": "off",
        "import/unambiguous": "off",

        "local/require-disable-directive-description": "error",

        "n/no-callback-literal": "error",
        "n/no-deprecated-api": "error",

        "node/no-process-env": "error",
        "node/no-top-level-await": ["error", { ignoreBin: true }],

        "promise/no-return-in-finally": "error",

        // tsc's noImplicitReturns covers this and understands exhaustive switches
        "typescript/consistent-return": "off",
        "typescript/consistent-type-imports": [
            "error",
            {
                disallowTypeAnnotations: false,
                fixStyle: "separate-type-imports",
                prefer: "type-imports",
            },
        ],
        "typescript/explicit-member-accessibility": "error",
        "typescript/explicit-module-boundary-types": "error",
        "typescript/no-empty-object-type": "error",
        "typescript/no-explicit-any": ["error", { fixToUnknown: true, ignoreRestArgs: false }],
        "typescript/no-extraneous-class": "error",
        "typescript/no-magic-numbers": "off",
        "typescript/no-unnecessary-condition": "error",
        "typescript/no-unused-expressions": [
            "error",
            {
                allowShortCircuit: false,
                allowTaggedTemplates: false,
                allowTernary: false,
                enforceForJSX: false,
            },
        ],
        "no-unused-vars": [
            "error",
            {
                args: "all",
                argsIgnorePattern: "^_",
                caughtErrors: "all",
                ignoreRestSiblings: false,
                vars: "all",
            },
        ],
        "typescript/parameter-properties": "error",
        "typescript/prefer-optional-chain": "error",
        "typescript/prefer-readonly-parameter-types": "off",
        // ReactNode includes Promise, so callbacks returning it would have to be async
        "typescript/promise-function-async": "off",
        "typescript/restrict-template-expressions": [
            "error",
            {
                allowAny: false,
                allowBoolean: false,
                allowNullish: false,
                allowNumber: false,
                allowRegExp: false,
            },
        ],
        "typescript/return-await": ["error", "in-try-catch"],
        "typescript/require-await": "error",
        "typescript/switch-exhaustiveness-check": [
            "error",
            {
                allowDefaultCaseForExhaustiveSwitch: false,
                considerDefaultExhaustiveForUnions: false,
                requireDefaultForNonUnion: true,
            },
        ],

        "react/capitalized-calls": "error",
        "react/forbid-component-props": [
            "error",
            {
                forbid: [
                    // the allowed components are third-party, the prop is their public sizing and styling API
                    {
                        propName: "className",
                        allowedFor: ["Typed.BarChart"],
                    },
                    { propName: "style", allowedFor: ["Map"] },
                ],
            },
        ],
        "react/function-component-definition": [
            "error",
            {
                namedComponents: "arrow-function",
                unnamedComponents: "arrow-function",
            },
        ],
        "react/invariant": "error",
        "react/memo-dependencies": "error",
        "react/no-deriving-state-in-effects": "error",
        "react/no-multi-comp": "error",
        "react/only-export-components": ["error", { allowConstantExport: true }],
        "react/require-render-return": "error",
        "react/rule-suppression": "error",
        "react/syntax": "error",
        "react/todo": "error",
        "react/unsupported-syntax": "error",
        "react/jsx-curly-brace-presence": [
            "error",
            {
                children: "never",
                propElementValues: "always",
                props: "never",
            },
        ],
        "react/jsx-filename-extension": ["error", { extensions: [".tsx"] }],
        "react/jsx-max-depth": "off",
        "react/jsx-no-literals": "off",
        "react/react-in-jsx-scope": "off",

        // React Compiler is enabled, it memoizes inline props
        "react-perf/jsx-no-new-array-as-prop": "off",
        "react-perf/jsx-no-new-function-as-prop": "off",
        "react-perf/jsx-no-new-object-as-prop": "off",

        "better-tailwindcss/enforce-canonical-classes": "error",
        "better-tailwindcss/enforce-consistent-important-position": "error",
        "better-tailwindcss/enforce-consistent-variable-syntax": "error",
        "better-tailwindcss/enforce-consistent-variant-order": "error",
        "better-tailwindcss/enforce-logical-properties": "error",
        "better-tailwindcss/enforce-shorthand-classes": "error",
        "better-tailwindcss/no-concatenated-classes": "error",
        "better-tailwindcss/no-conflicting-classes": "error",
        "better-tailwindcss/no-deprecated-classes": "error",
        "better-tailwindcss/no-duplicate-classes": "error",
        "better-tailwindcss/no-unknown-classes": [
            "error",
            {
                // classes targeting Recharts' own markup
                ignore: ["recharts-.*"],
            },
        ],
        "better-tailwindcss/no-unnecessary-whitespace": "error",

        "perfectionist/sort-array-includes": "error",
        "perfectionist/sort-classes": "error",
        "perfectionist/sort-enums": "error",
        "perfectionist/sort-exports": "error",
        "perfectionist/sort-heritage-clauses": "error",
        "perfectionist/sort-interfaces": "error",
        "perfectionist/sort-intersection-types": "error",
        "perfectionist/sort-jsx-props": "error",
        "perfectionist/sort-maps": "error",
        "perfectionist/sort-named-exports": "error",
        "perfectionist/sort-named-imports": "error",
        "perfectionist/sort-object-types": "error",
        "perfectionist/sort-sets": "error",
        "perfectionist/sort-union-types": "error",
        "perfectionist/sort-variable-declarations": "error",

        "react-hook-form/destructuring-formstate": "error",
        "react-hook-form/no-access-control": "error",
        "react-hook-form/no-nested-object-setvalue": "error",
        "react-hook-form/no-use-watch": "error",
    },
    overrides: [
        {
            files: ["*.config.ts", "**/test.setup.ts"],
            env: {
                node: true,
            },
            rules: {
                "import/no-nodejs-modules": "off",
            },
        },
        {
            files: ["*.config.ts", "oxlint.plugin.ts"],
            rules: {
                "import/no-default-export": "off",
            },
        },
        {
            files: ["**/*.test.ts", "**/*.test.tsx"],
            plugins: [...plugins, "vitest"],
            rules: {
                "vitest/no-hooks": "error",
                "vitest/no-importing-vitest-globals": "off",
                "vitest/prefer-expect-assertions": "error",
                "vitest/require-test-timeout": "error",
                "vitest/require-top-level-describe": "error",
            },
        },
        {
            files: ["**/test.setup.ts"],
            plugins: [...plugins, "vitest"],
            rules: {
                "vitest/no-hooks": "off",
                "vitest/no-importing-vitest-globals": "off",
            },
        },
    ],
});

export default config;
