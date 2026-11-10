import type { Runtime } from "../runtime.js";
export type CatalogResources = {
    mcpServers?: string[];
    skills?: string[];
    agents?: string[];
    ambientAgents?: string[];
    workflows?: string[];
    scenarios?: string[];
};
export type CatalogCopyOptions = CatalogResources & {
    source: Runtime;
    destination: Runtime;
    workflowAgentId?: string;
    ambientAgentId?: string;
    dryRun: boolean;
    confirm?: boolean;
};
export declare function copyCatalog(options: CatalogCopyOptions): Promise<{
    dry_run: boolean;
    source_profile_id: string;
    destination_profile_id: string;
    resource_count: number;
    resources: Record<string, unknown>[];
    conflicts: string[];
    dependency_order: string[];
    sessions_copied: boolean;
    credentials_copied: boolean;
} | {
    dry_run: boolean;
    applied: {
        kind: string;
        id: string;
        result: unknown;
    }[];
    source_profile_id: string;
    destination_profile_id: string;
    resource_count: number;
    resources: Record<string, unknown>[];
    conflicts: string[];
    dependency_order: string[];
    sessions_copied: boolean;
    credentials_copied: boolean;
}>;
