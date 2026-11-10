import type { InstallOptions } from "./pluginInstall.js";
export type InstallPlan = {
    dry_run: true;
    client: InstallOptions["client"];
    current_version: string | null;
    target_version: string;
    source: {
        kind: "local" | "download";
        location: string;
        ref?: string;
        sha256?: string;
    };
    launcher: {
        kind: "absolute" | "npx";
        bridge: string;
    };
    actions: string[];
    native: {
        build_only: boolean;
        code_path?: string;
        gradle_path?: string;
        plugins_dir?: string;
    };
    cleanup: {
        policy: "preserve" | "backup-and-remove" | "skipped";
        backup_root?: string;
    };
};
export declare function createInstallPlan(options: InstallOptions): Promise<InstallPlan>;
