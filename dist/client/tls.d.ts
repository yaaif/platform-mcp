import type { Config } from "../config.js";
export type TlsMaterial = {
    ca?: string | string[];
    cert?: string;
    key?: string;
};
/** Load CA / client cert material for subsequent yaaifFetch calls. */
export declare function installTlsDispatcher(cfg: Config): TlsMaterial | null;
export declare function getTlsMaterial(): TlsMaterial;
/** fetch()-compatible helper that applies optional extra CA / client mTLS. */
export declare function yaaifFetch(input: string | URL, init?: RequestInit): Promise<Response>;
