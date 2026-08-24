import type { Config } from "../config.js";
export declare function exportProfileEnv(cfg: Config): {
    shell: string;
    client: Config["client"]["id"];
    client_variables: Record<string, string>;
    cursor_plugin_variables?: Record<string, string>;
    codex_plugin_variables?: Record<string, string>;
};
