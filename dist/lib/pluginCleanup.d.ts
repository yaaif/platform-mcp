import type { BridgeClient } from "../config.js";
export type CleanupResult = {
    removed: string[];
    backupDir?: string;
};
export declare function readInstalledVersion(client: BridgeClient, root: string): Promise<string>;
export declare function retirePluginPaths(paths: string[], backupRoot: string): Promise<CleanupResult>;
export declare function cleanupVersionedCache(options: {
    client: BridgeClient;
    cacheRoot: string;
    currentVersion: string;
    backupRoot: string;
}): Promise<CleanupResult>;
