import type { Runtime } from "../runtime.js";
export type McpServerCopyOptions = {
    source: Runtime;
    destination: Runtime;
    serverId: string;
    newName?: string;
    newEndpoint?: string;
    dryRun: boolean;
    confirm?: boolean;
};
export declare function copyMcpServer(options: McpServerCopyOptions): Promise<{
    server_id: string;
    name: string;
    endpoint: string;
    transport_type: string;
    source_profile_id: string;
    destination_profile_id: string;
    conflict: boolean;
    header_mappings: {
        value_prefix?: string | undefined;
        header_name: string;
        credential_key: string;
    }[];
    credential_profiles_required: (string | undefined)[];
    credential_ids_copied: boolean;
    credential_mappings_copied: boolean;
    refresh_tools: boolean;
    dry_run: boolean;
} | {
    created: {
        id: string;
        verified: unknown;
        refresh_required: boolean;
    };
    server_id: string;
    name: string;
    endpoint: string;
    transport_type: string;
    source_profile_id: string;
    destination_profile_id: string;
    conflict: boolean;
    header_mappings: {
        value_prefix?: string | undefined;
        header_name: string;
        credential_key: string;
    }[];
    credential_profiles_required: (string | undefined)[];
    credential_ids_copied: boolean;
    credential_mappings_copied: boolean;
    refresh_tools: boolean;
    dry_run: boolean;
}>;
