/** Shared MCP deployment helpers for compose + kubernetes_gitops. */
export type SecretEnvMapping = {
    env_name: string;
    credential_id: string;
    credential_key: string;
};
export type ClientSecretHeaderMapping = {
    header_name: string;
    credential_id: string;
    credential_key: string;
};
export type DeploymentRecord = {
    id?: string;
    name?: string;
    image?: string;
    registry_credential_id?: string;
    deployment_method?: string;
    container_port?: number;
    mcp_path?: string;
    endpoint_mode?: string;
    endpoint_host?: string;
    transport_type?: string;
    env?: Record<string, string>;
    secret_env?: SecretEnvMapping[];
    client_secret_headers?: ClientSecretHeaderMapping[];
    auto_register?: boolean;
    auto_import_tools?: boolean;
};
export type DeploymentSettings = {
    default_deployment_method?: string;
    docker_compose?: unknown;
    kubernetes?: unknown;
    gitops?: unknown;
};
/** Normalize transport to API-valid values (STREAMABLE_HTTP | SSE). */
export declare function normalizeTransportType(raw?: string): "STREAMABLE_HTTP" | "SSE";
export declare function isKubernetesGitops(method?: string): boolean;
/**
 * Resolve deployment method: explicit arg wins; else tenant settings default;
 * else docker_compose.
 */
export declare function resolveDeploymentMethod(explicit: string | undefined, settings: DeploymentSettings | null | undefined): "docker_compose" | "kubernetes_gitops";
export type DeploymentUpdateOverrides = {
    name?: string;
    image?: string;
    registry_credential_id?: string | null;
    deployment_method?: string;
    container_port?: number;
    mcp_path?: string;
    endpoint_mode?: string;
    /** Set to null to clear endpoint_host on PUT. */
    endpoint_host?: string | null;
    transport_type?: string;
    env?: Record<string, string>;
    secret_env?: SecretEnvMapping[];
    client_secret_headers?: ClientSecretHeaderMapping[];
    auto_register?: boolean;
    auto_import_tools?: boolean;
};
/** Build PUT body from a deployment record, optionally overriding fields. */
export declare function deploymentToUpdateBody(deployment: DeploymentRecord, overrides?: DeploymentUpdateOverrides): Record<string, unknown>;
/**
 * Choose logs API path based on deployment method.
 * Compose → /logs; kubernetes_gitops → /k8s/logs.
 */
export declare function deploymentLogsPath(deploymentId: string, method: string | undefined, tail?: number): string;
