import type { Config } from "../config.js";
export declare function exportProfileEnv(cfg: Config): {
    shell: string;
    cursor_plugin_variables: Record<string, string>;
};
