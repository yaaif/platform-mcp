import type { BridgeClient } from "../config.js";
export type CommandRunner = (file: string, args: string[], cwd: string) => Promise<void>;
export type NativeInstallOptions = {
    client: BridgeClient;
    sourceDir: string;
    stateHome: string;
    offline: boolean;
    buildOnly?: boolean;
    codePath?: string;
    gradlePath?: string;
    jetbrainsPluginsDir?: string;
    runCommand?: CommandRunner;
};
export type NativeInstallResult = {
    artifact: string;
    installed: boolean;
    pluginsDir?: string;
};
export declare function installVsCodePlugin(options: NativeInstallOptions): Promise<NativeInstallResult>;
export declare function discoverJetBrainsPluginsDir(home?: string, platform?: NodeJS.Platform, appData?: string | undefined): Promise<string>;
export declare function installIntellijPlugin(options: NativeInstallOptions): Promise<NativeInstallResult>;
export declare function installNativePlugin(options: NativeInstallOptions): Promise<NativeInstallResult>;
