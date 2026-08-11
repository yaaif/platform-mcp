import type { Config } from "../config.js";
export type TlsMaterial = {
    ca?: string | string[];
    cert?: string;
    key?: string;
};
export type TlsResolveInfo = {
    /** Absolute path actually loaded into the HTTPS agent (if any). */
    ca_file: string | null;
    /** How the CA was chosen. */
    ca_source: "explicit" | "mkcert-auto" | "none";
    /** True when config URLs target *.yaaif.local (local Traefik / mkcert). */
    local_dev_hosts: boolean;
    /** Candidate mkcert paths that exist on disk (for doctor hints). */
    mkcert_candidates: string[];
};
/** Ignore empty values and unexpanded Cursor plugin placeholders like `${YAAIF_EXTRA_CA_FILE}`. */
export declare function resolvedPath(raw: string | undefined | null): string;
/** Local Traefik / mkcert hosts used by builtin `local` and `local-hybrid` profiles. */
export declare function configUsesLocalDevHosts(cfg: Config): boolean;
/**
 * Discover mkcert root CA paths (macOS / Linux / CAROOT / `mkcert -CAROOT`).
 * Node does not trust the system keychain by default, so local Traefik mkcert
 * certs need this PEM even after `mkcert -install`.
 */
export declare function discoverMkcertCaCandidates(env?: NodeJS.ProcessEnv): string[];
export declare function resolveCaFile(cfg: Config, env?: NodeJS.ProcessEnv): TlsResolveInfo;
/**
 * Load CA / client cert material for subsequent yaaifFetch calls.
 *
 * For `*.yaaif.local`, always merge the mkcert root CA when present — even if
 * `YAAIF_EXTRA_CA_FILE` / `NODE_EXTRA_CA_CERTS` already set an explicit CA —
 * so Cursor plugin vars or a corporate bundle cannot shadow Traefik trust.
 */
export declare function installTlsDispatcher(cfg: Config): TlsMaterial | null;
export declare function getTlsMaterial(): TlsMaterial;
export declare function getTlsResolveInfo(): TlsResolveInfo;
/** fetch()-compatible helper that applies optional extra CA / client mTLS. */
export declare function yaaifFetch(input: string | URL, init?: RequestInit): Promise<Response>;
