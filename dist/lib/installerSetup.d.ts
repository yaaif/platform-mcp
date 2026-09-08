import { ProfileStore } from "../platform/profiles.js";
export declare const SETUP_ACTIONS: readonly ["detect", "profile", "login", "whoami", "all"];
export type SetupAction = (typeof SETUP_ACTIONS)[number];
export type BuiltinProfileId = "hosted" | "local-hybrid" | "local";
export type ProbeMap = Record<BuiltinProfileId, boolean>;
export type DetectResult = {
    profile_id: string;
    kept_existing: boolean;
    reachable: ProbeMap;
    reason: string;
};
export type SetupStatus = {
    profile_id: string;
    kept_existing: boolean;
    login: "ok" | "skipped" | "failed" | "required";
    email?: string;
    tenant_id?: string;
    tenant_name?: string;
    needs_tenant_selection?: boolean;
    message: string;
    updated_at: string;
};
export type ProfileProbeFn = (profileId: BuiltinProfileId) => Promise<boolean>;
export type PlatformPromptChoice = {
    action: "hosted" | "keep" | "url";
    url?: string;
};
export type PlatformPromptFn = (input: {
    existingId?: string;
    existingApi?: string;
}) => Promise<PlatformPromptChoice>;
export declare function parseSetupAction(argv: string[]): SetupAction | null;
export declare function parseProfileFlag(argv: string[]): string | undefined;
export declare function parseYaaifUrl(argv: string[]): string | undefined;
export declare function looksLikePlatformUrl(raw: string): boolean;
export declare function parsePlatformPromptAnswer(raw: string, opts: {
    hasExisting: boolean;
}): {
    action: "hosted" | "keep" | "url" | "other" | "invalid";
    url?: string;
};
export declare function shouldPromptPlatform(action: SetupAction, argv: string[], opts?: {
    interactive?: boolean;
    prompt?: PlatformPromptFn;
}): boolean;
export declare function chooseDetectedProfile(opts: {
    existingId?: string | null;
    reachable: ProbeMap;
}): {
    profile_id: string;
    kept_existing: boolean;
    reason: string;
};
export declare function loginSkippedByEnv(env?: NodeJS.ProcessEnv, opts?: {
    noLogin?: boolean;
    argv?: string[];
}): boolean;
export declare function defaultProfileProbe(profileId: BuiltinProfileId, timeoutMs?: number): Promise<boolean>;
export declare function detectDefaultProfile(store: ProfileStore, opts?: {
    probe?: ProfileProbeFn;
    keepExisting?: boolean;
}): Promise<DetectResult>;
export declare function writeSetupStatus(stateHome: string, status: SetupStatus): Promise<string>;
export declare function runInstallerSetup(action: SetupAction, opts?: {
    argv?: string[];
    probe?: ProfileProbeFn;
    noLogin?: boolean;
    prompt?: PlatformPromptFn;
    interactive?: boolean;
}): Promise<number>;
