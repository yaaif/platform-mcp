import type { BridgeClient } from "../config.js";
import { type PlatformPromptFn, type ProfileProbeFn } from "./installerSetup.js";
export declare const MCP_PACKAGE_PIN = "@yaaif/platform-mcp@1.3.4";
export declare const CURSOR_MCP_ENV: Record<string, string>;
export declare const CLAUDE_MCP_ENV: Record<string, string>;
export type InstallOptions = {
    client: BridgeClient;
    pluginSrc?: string;
    offline: boolean;
    noLogin: boolean;
    force: boolean;
    cliPathExplicit: boolean;
    cursorDest?: string;
    cliPath?: string;
    nodePath?: string;
};
export type McpServerEntry = {
    command: string;
    args: string[];
    env?: Record<string, string>;
};
export type InstallHealthCheck = {
    name: string;
    ok: boolean;
    detail?: unknown;
};
export declare function parseInstallAction(argv: string[]): boolean;
export declare function parsePluginSrc(argv: string[]): string | undefined;
export declare function parseOffline(argv: string[]): boolean;
export declare function parseNoLogin(argv: string[]): boolean;
export declare function parseForce(argv: string[]): boolean;
export declare function parseCliPath(argv: string[]): string | undefined;
export declare function parseInstallOptions(argv: string[]): InstallOptions;
export declare function assertNode20(version?: string): void;
export declare function compareDottedVersion(left: string, right: string): number;
export declare function cursorPluginDest(home?: string): string;
export declare function isUnstableCliPath(p: string): boolean;
export declare function assertStableCliPath(p: string, allowUnstable?: boolean): void;
export declare function defaultCliJsPath(fromMetaUrl?: string): string;
export declare function defaultMcpEnv(client: BridgeClient): Record<string, string> | undefined;
export declare function buildMcpServerEntry(opts: {
    client: BridgeClient;
    offline: boolean;
    nodePath?: string;
    cliPath?: string;
    env?: Record<string, string>;
}): McpServerEntry;
export declare function resolveMcpJsonPath(client: BridgeClient, pluginRoot: string): string;
export declare function shouldCopyPluginPath(srcRoot: string, from: string): boolean;
export declare function readPluginVersion(pluginRoot: string): string;
export declare function pluginDestHealthy(dest: string): boolean;
export declare function assertCursorPluginSrc(src: string): void;
export declare function assertMcpPluginSrc(client: BridgeClient, src: string): void;
export declare function copyCursorPlugin(src: string, dest: string): Promise<void>;
export declare function stageCursorPlugin(src: string, dest: string): Promise<string>;
export declare function swapStagedPlugin(staging: string, dest: string): Promise<void>;
export declare function writeMcpJson(path: string, entry: McpServerEntry): Promise<void>;
export declare function collectInstallHealth(opts: {
    client: BridgeClient;
    cursorDest?: string;
    mcpJsonPath?: string;
    nodeVersion?: string;
}): InstallHealthCheck[];
export declare function mcpLaunchCheck(client: BridgeClient, mcpPath: string): InstallHealthCheck;
export declare function verifyInstall(opts: {
    client: BridgeClient;
    cursorDest?: string;
    mcpJsonPath?: string;
}): Promise<InstallHealthCheck[]>;
export declare function nextSteps(opts: {
    client: BridgeClient;
    pluginDest?: string;
    pluginSrc?: string;
}): string;
export declare function runInstall(opts?: {
    argv?: string[];
    probe?: ProfileProbeFn;
    prompt?: PlatformPromptFn;
    interactive?: boolean;
}): Promise<number>;
export declare function executeInstall(options: InstallOptions, setup?: {
    argv: string[];
    probe?: ProfileProbeFn;
    prompt?: PlatformPromptFn;
    interactive?: boolean;
}): Promise<number>;
