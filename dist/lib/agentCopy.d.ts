import type { Runtime } from "../runtime.js";
export type AgentCopyOptions = {
    source: Runtime;
    destination: Runtime;
    agentId: string;
    newName?: string;
    dryRun: boolean;
    confirm?: boolean;
};
export declare function copyAgent(options: AgentCopyOptions): Promise<{
    agent_id: string;
    name: string;
    agent_type: string;
    source_profile_id: string;
    destination_profile_id: string;
    conflict: boolean;
    required_skill_ids: string[];
    skill_mappings_copied: boolean;
    scenario_bindings_copied: boolean;
    enabled_for_review: boolean;
    dry_run: boolean;
} | {
    created: {
        id: string;
        verified: unknown;
    };
    agent_id: string;
    name: string;
    agent_type: string;
    source_profile_id: string;
    destination_profile_id: string;
    conflict: boolean;
    required_skill_ids: string[];
    skill_mappings_copied: boolean;
    scenario_bindings_copied: boolean;
    enabled_for_review: boolean;
    dry_run: boolean;
}>;
