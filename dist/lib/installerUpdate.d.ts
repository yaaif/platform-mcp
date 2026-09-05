export type InstallerUpdateCheck = {
    ok: boolean;
    detail: Record<string, unknown>;
};
export declare function compareDottedVersion(a: string, b: string): number;
export declare function checkInstallerUpdate(stateHome: string, fetchFn?: typeof fetch): Promise<InstallerUpdateCheck>;
