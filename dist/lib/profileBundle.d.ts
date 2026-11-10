import type { PlatformProfile, ProfileStore } from "../platform/profiles.js";
export declare const PROFILE_BUNDLE_FORMAT = "yaaif.platform-profiles/v1";
export type ProfileBundle = {
    format: typeof PROFILE_BUNDLE_FORMAT;
    exported_at: string;
    active_profile_id?: string;
    profiles: PlatformProfile[];
};
export declare function createProfileBundle(profiles: PlatformProfile[], activeProfileId?: string): ProfileBundle;
export declare function validateProfileBundle(value: unknown): ProfileBundle;
export declare function writeProfileBundle(path: string, bundle: ProfileBundle): Promise<void>;
export declare function readProfileBundle(path: string): Promise<ProfileBundle>;
export declare function importProfileBundle(store: ProfileStore, bundle: ProfileBundle, options: {
    activate?: string;
    dryRun: boolean;
    confirm?: boolean;
}): Promise<{
    dry_run: boolean;
    entries: {
        id: string;
        action: "import" | "skip_builtin" | "conflict";
    }[];
    conflicts: string[];
    import_count: number;
    skipped_builtin_count: number;
    activate: string | null;
    sessions_copied: boolean;
} | {
    imported: boolean;
    dry_run: boolean;
    entries: {
        id: string;
        action: "import" | "skip_builtin" | "conflict";
    }[];
    conflicts: string[];
    import_count: number;
    skipped_builtin_count: number;
    activate: string | null;
    sessions_copied: boolean;
}>;
