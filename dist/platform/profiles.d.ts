import { type Config } from "../config.js";
export type PlatformProfile = {
    id: string;
    label: string;
    description?: string;
    builtin?: boolean;
    oidc_authority: string;
    api_base_url: string;
    agent_base_url: string;
    control_plane_base_url: string;
    approval_base_url: string;
    oidc_client_id?: string;
    /** Absolute path to extra CA PEM (corporate / local Traefik). */
    extra_ca_file?: string;
    /** Absolute path to client cert PEM for mTLS. */
    client_cert_file?: string;
    /** Absolute path to client key PEM for mTLS. */
    client_key_file?: string;
};
export type ActiveProfileState = {
    profile_id: string;
    updated_at: string;
};
export declare function deriveServiceUrls(apiBase: string): {
    api_base_url: string;
    agent_base_url: string;
    control_plane_base_url: string;
    approval_base_url: string;
};
export declare const HOSTED_PLATFORM_URL = "https://platform.yaaif.ai";
export declare const LOCAL_PLATFORM_URL = "https://platform.yaaif.local";
export declare function normalizePlatformUrl(raw: string): string;
export declare function profileIdFromHostname(hostname: string): string;
/** Map a platform base (or OIDC) URL to hosted, local, or a custom profile. */
export declare function profileFromPlatformUrl(raw: string, oidcClientId?: string): PlatformProfile;
export declare function builtinProfiles(oidcClientId?: string): PlatformProfile[];
export declare const BUILTIN_PROFILES: PlatformProfile[];
/** A tool tried to switch away from the platform the installation fixed. */
export declare class PlatformLockedError extends Error {
    readonly locked: PlatformProfile;
    readonly code = "platform_locked";
    constructor(locked: PlatformProfile, attempted: string);
}
export declare class ProfileStore {
    private readonly stateHome;
    private readonly defaultOidcClientId;
    readonly customPath: string;
    readonly activePath: string;
    /** Set by lock(): the only profile setActive accepts, which tools cannot overwrite. */
    private locked;
    constructor(stateHome: string, defaultOidcClientId?: string);
    ensureHome(): Promise<void>;
    listCustom(): Promise<PlatformProfile[]>;
    saveCustom(profiles: PlatformProfile[]): Promise<void>;
    get lockedProfile(): PlatformProfile | null;
    /**
     * Bind this store to the installation's platform: save the profile (custom
     * ones are rewritten from the environment on every start, so an edit cannot
     * stick), make it active, and refuse any other from then on.
     */
    lock(profile: PlatformProfile): Promise<PlatformProfile>;
    upsertCustom(profile: PlatformProfile): Promise<PlatformProfile>;
    cloneCustom(sourceId: string, destinationId: string, label?: string): Promise<PlatformProfile>;
    deleteCustom(profileId: string): Promise<boolean>;
    listAll(): Promise<PlatformProfile[]>;
    get(profileId: string): Promise<PlatformProfile | null>;
    getActive(): Promise<ActiveProfileState | null>;
    setActive(profileId: string): Promise<ActiveProfileState>;
}
export declare function applyProfileToConfig(cfg: Config, profile: PlatformProfile): Config;
export declare function inferProfileId(cfg: Config): string;
export declare function applyActiveProfile(cfg: Config, store: ProfileStore): Promise<PlatformProfile | null>;
/**
 * The profile a locked installation runs with, from its environment: a
 * built-in profile when the endpoints match one, else a custom profile named
 * after the API host (or YAAIF_PLATFORM_PROFILE).
 */
export declare function lockedProfileFromConfig(cfg: Config): PlatformProfile;
