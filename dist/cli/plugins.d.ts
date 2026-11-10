import type { BridgeClient } from "../config.js";
import { type InstallHealthCheck } from "../lib/pluginInstall.js";
export declare const PLUGIN_CLIENTS: BridgeClient[];
export type PluginContract = {
    contractVersion: number;
    bridgeVersion: string;
    mcpPackage: string;
    pluginVersions: Record<string, string>;
};
export declare function loadPluginContract(): Promise<PluginContract>;
export declare function nativeUpdateInstruction(client: BridgeClient): string;
export declare function pluginCatalog(): Promise<{
    client: BridgeClient;
    plugin_version: string;
    mcp_package: string;
    native_update: string;
}[]>;
export declare function checkPlugin(options: {
    client: BridgeClient;
    pluginSrc?: string;
    online?: boolean;
}): Promise<{
    client: BridgeClient;
    ok: boolean;
    checks: InstallHealthCheck[];
    version?: string;
    expected_version?: string;
    mcp_package?: string;
    latest_npm_version?: string;
    native_update?: string;
}>;
export declare function installOrUpdatePlugin(action: "install" | "update", client: BridgeClient, argv: string[]): Promise<number>;
