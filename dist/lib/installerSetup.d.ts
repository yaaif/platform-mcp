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
export declare function parseSetupAction(argv: string[]): SetupAction | null;
export declare function parseProfileFlag(argv: string[]): string | undefined;
export declare function chooseDetectedProfile(opts: {
    existingId?: string | null;
    reachable: ProbeMap;
}): {
    profile_id: string;
    kept_existing: boolean;
    reason: string;
};
export declare function loginSkippedByEnv(env?: NodeJS.ProcessEnv): boolean;
export declare function defaultProfileProbe(profileId: BuiltinProfileId, timeoutMs?: number): Promise<boolean>;
export declare function detectDefaultProfile(store: ProfileStore, opts?: {
    probe?: ProfileProbeFn;
    keepExisting?: boolean;
}): Promise<DetectResult>;
export declare function writeSetupStatus(stateHome: string, status: SetupStatus): Promise<string>;
export declare function runInstallerSetup(action: SetupAction, opts?: {
    argv?: string[];
    probe?: ProfileProbeFn;
}): Promise<number>;
