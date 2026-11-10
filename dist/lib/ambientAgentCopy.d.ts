import type { Runtime } from "../runtime.js";
export type AmbientAgentCopyOptions = {
    source: Runtime;
    destination: Runtime;
    ambientAgentId: string;
    workflowAgentId?: string;
    dryRun: boolean;
    confirm?: boolean;
};
export declare function copyAmbientAgent(options: AmbientAgentCopyOptions): Promise<{
    ambient_agent_id: string;
    name: string;
    workflow_agent_id: string;
    source_profile_id: string;
    destination_profile_id: string;
    conflict: boolean;
    enabled_for_review: boolean;
    workflow_async_enabled: boolean;
    requires_approval: boolean;
    triggers_copied: boolean;
    credentials_copied: boolean;
    dry_run: boolean;
} | {
    created: {
        id: string;
        verified: unknown;
    };
    ambient_agent_id: string;
    name: string;
    workflow_agent_id: string;
    source_profile_id: string;
    destination_profile_id: string;
    conflict: boolean;
    enabled_for_review: boolean;
    workflow_async_enabled: boolean;
    requires_approval: boolean;
    triggers_copied: boolean;
    credentials_copied: boolean;
    dry_run: boolean;
}>;
