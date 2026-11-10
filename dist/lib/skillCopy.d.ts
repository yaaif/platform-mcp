import type { Runtime } from "../runtime.js";
export type SkillCopyOptions = {
    source: Runtime;
    destination: Runtime;
    skillId: string;
    newSkillId?: string;
    dryRun: boolean;
    confirm?: boolean;
};
export declare function copySkill(options: SkillCopyOptions): Promise<{
    skill_id: string;
    new_skill_id: string;
    source_profile_id: string;
    destination_profile_id: string;
    conflict: boolean;
    files: {
        source: string;
        destination: string;
    }[];
    excluded: {
        path: string;
        reason: string;
    }[];
    total_bytes: number;
    mappings_copied: boolean;
    bindings_copied: boolean;
    dry_run: boolean;
} | {
    created: {
        id: string;
        verified: unknown;
    };
    skill_id: string;
    new_skill_id: string;
    source_profile_id: string;
    destination_profile_id: string;
    conflict: boolean;
    files: {
        source: string;
        destination: string;
    }[];
    excluded: {
        path: string;
        reason: string;
    }[];
    total_bytes: number;
    mappings_copied: boolean;
    bindings_copied: boolean;
    dry_run: boolean;
}>;
