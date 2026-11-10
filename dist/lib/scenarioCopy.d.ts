import type { Runtime } from "../runtime.js";
export type ScenarioCopyOptions = {
    source: Runtime;
    destination: Runtime;
    specId: string;
    revision?: number;
    newSlug?: string;
    dryRun: boolean;
    confirm?: boolean;
};
export declare function copyScenario(options: ScenarioCopyOptions): Promise<{
    spec_id: string;
    revision: number;
    manifest_hash: string | null;
    source_profile_id: string;
    destination_profile_id: string;
    slug: string;
    name: string;
    conflict: boolean;
    would_create: boolean;
    counts: {
        segments: number;
        requirements: number;
        slots: number;
    };
    excluded: string[];
    dry_run: boolean;
} | {
    created: {
        id: string;
        slug: string;
        verified: unknown;
    };
    spec_id: string;
    revision: number;
    manifest_hash: string | null;
    source_profile_id: string;
    destination_profile_id: string;
    slug: string;
    name: string;
    conflict: boolean;
    would_create: boolean;
    counts: {
        segments: number;
        requirements: number;
        slots: number;
    };
    excluded: string[];
    dry_run: boolean;
}>;
