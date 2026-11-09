import { fileURLToPath } from "node:url";

import { codecovVitePlugin } from "@codecov/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import type { Plugin, UserConfig } from "vite";
import { build, loadEnv } from "vite";
import { checker } from "vite-plugin-checker";
import svgr from "vite-plugin-svgr";
import type { ViteUserConfigFn } from "vitest/config";
import { defineConfig } from "vitest/config";

function resolvePort(environmentValue: string | undefined, fallback: number): number {
    if (environmentValue === undefined || environmentValue.trim() === "") {
        return fallback;
    }

    const parsed = Number(environmentValue);

    return Number.isSafeInteger(parsed) && parsed > 0 && parsed <= 65_535 ? parsed : fallback;
}

function emitBuildId(buildId: string): Plugin {
    return {
        name: "emit-build-id",
        generateBundle() {
            // must match `BUILD_ID_FILE` in `crates/endless-ssh-rs-with-web/src/router/html_router.rs`
            this.emitFile({ type: "asset", fileName: "build-id", source: buildId });
        },
    };
}

// a classic inline script at the start of <head> runs before the first paint, a module script does not
function inlineHeadScript(entry: string): Plugin {
    return {
        name: "inline-head-script",
        async transformIndexHtml() {
            const result = await build({
                configFile: false,
                logLevel: "warn",
                build: {
                    lib: { entry, formats: ["iife"], name: "headScript" },
                    minify: true,
                    target: "esnext",
                    write: false,
                },
            });

            // lib mode returns one output per format
            const [output] = Array.isArray(result) ? result : [];

            if (output === undefined) {
                throw new TypeError("Expected the IIFE build to return its output");
            }

            const [chunk] = output.output;

            return [{ tag: "script", children: chunk.code, injectTo: "head-prepend" }];
        },
    };
}

const configFunction: ViteUserConfigFn = defineConfig(({ command, mode }) => {
    const environment = loadEnv(mode, process.cwd(), "");
    const port = resolvePort(environment["VITE_PORT"], 4000);
    const buildId = command === "build" ? (environment["BUILD_ID"] ?? "dev") : "dev";

    const config: UserConfig = {
        appType: "spa",
        cacheDir: "../../node_modules/.cache/",
        define: {
            "import.meta.env.BUILD_ID": JSON.stringify(buildId),
        },
        build: {
            minify: true,
            target: "esnext",
            emptyOutDir: true,
            sourcemap: true,
            outDir: "../../dist",
            rolldownOptions: {
                output: {
                    keepNames: true,
                },
            },
        },
        resolve: {
            tsconfigPaths: true,
        },
        plugins: [
            svgr(),
            react({ compiler: { panicThreshold: "all_errors" } }),
            // `tsconfig.json` is in the repository root, outside Vite's `root`
            checker({ typescript: { root: import.meta.dirname } }),
            tailwindcss(),
            codecovVitePlugin({
                enableBundleAnalysis: environment["GITHUB_ACTIONS"] === "true",
                bundleName: "endless-ssh-rs-front-end",
                oidc: {
                    useGitHubOIDC: true,
                },
                telemetry: false,
            }),
            emitBuildId(buildId),
            inlineHeadScript(fileURLToPath(new URL("front-end/src/entrypoints/theme.ts", import.meta.url))),
        ],
        optimizeDeps: {
            noDiscovery: true,
            include: ["ip-address", "maplibre-gl", "react-dom/client", "recharts"],
        },
        root: "front-end/src",
        server: {
            port,
            host: "127.0.0.1",
            strictPort: true,
            proxy: {
                "/api": {
                    // on local development, target only binds to IPv4
                    target: "http://127.0.0.1:3000",
                    changeOrigin: true,
                    secure: false,
                    ws: true,
                },
            },
        },
        test: {
            coverage: {
                reporter: ["json", "html", "text"],
                provider: "v8",
                reportsDirectory: "../../coverage/vitest",
            },
            environment: "jsdom",
            environmentOptions: {
                // jsdom: {},
            },
            globals: false,
            outputFile: {
                junit: "../../reports/vitest/test-report.xml",
            },
            restoreMocks: true,
            setupFiles: ["./test.setup.ts"],
            unstubGlobals: true,
        },
    };

    return config;
});

export default configFunction;
