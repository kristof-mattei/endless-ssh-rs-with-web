declare module "eslint-plugin-react-hook-form" {
    import type { Linter } from "eslint";

    interface Ruleset {
        rules: Linter.RulesRecord;
    }

    type Configs = {
        recommended: Ruleset;
        "react-compiler": Ruleset;
    } & Record<string, Ruleset>;

    interface Plugin {
        configs: Configs;
    }

    const plugin: Plugin;

    export = plugin;
}
