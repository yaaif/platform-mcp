import type { Runtime } from "../runtime.js";
export type AmbientCopyOptions = {
    source: Runtime;
    destination: Runtime;
    workflowId: string;
    newName?: string;
    ambientAgentId?: string;
    dryRun: boolean;
    confirm?: boolean;
};
export declare function copyAmbientWorkflow(options: AmbientCopyOptions): Promise<{
    workflow_id: string;
    name: string;
    ambient_agent_id: string;
    source_profile_id: string;
    destination_profile_id: string;
    conflict: boolean;
    dependencies: string[];
    disabled_for_review: boolean;
    workflow_async_enabled: boolean;
    requires_approval: boolean;
    run_history_copied: boolean;
    credentials_copied: boolean;
    dry_run: boolean;
} | {
    created: {
        id: string;
        verified: unknown;
    };
    workflow_id: string;
    name: string;
    ambient_agent_id: string;
    source_profile_id: string;
    destination_profile_id: string;
    conflict: boolean;
    dependencies: string[];
    disabled_for_review: boolean;
    workflow_async_enabled: boolean;
    requires_approval: boolean;
    run_history_copied: boolean;
    credentials_copied: boolean;
    dry_run: boolean;
}>;
