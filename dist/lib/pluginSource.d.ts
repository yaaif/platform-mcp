import type { BridgeClient } from "../config.js";
import { yaaifFetch } from "../client/tls.js";
export type DownloadedPluginSource = {
    path: string;
    cleanup: () => Promise<void>;
};
export type DownloadPluginOptions = {
    client: BridgeClient;
    ref?: string;
    sha256?: string;
    baseUrl?: string;
    fetchImpl?: typeof yaaifFetch;
};
export declare function pluginArchiveUrl(client: BridgeClient, ref?: string, baseUrl?: string): string;
export declare function extractPluginTarGz(archive: Buffer, destination: string): Promise<void>;
export declare function downloadPluginSource(options: DownloadPluginOptions): Promise<DownloadedPluginSource>;
