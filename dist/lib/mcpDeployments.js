/** Shared MCP deployment helpers for compose + kubernetes_gitops. */
/** Normalize transport to API-valid values (STREAMABLE_HTTP | SSE). */
export function normalizeTransportType(raw) {
    const t = (raw || "").trim().toUpperCase();
    if (t === "SSE")
        return "SSE";
    // Legacy/invalid "HTTP" and empty → STREAMABLE_HTTP
    return "STREAMABLE_HTTP";
}
export function isKubernetesGitops(method) {
    return (method || "").trim() === "kubernetes_gitops";
}
/**
 * Resolve deployment method: explicit arg wins; else tenant settings default;
 * else docker_compose.
 */
export function resolveDeploymentMethod(explicit, settings) {
    const fromArg = (explicit || "").trim();
    if (fromArg === "docker_compose" || fromArg === "kubernetes_gitops") {
        return fromArg;
    }
    const fromSettings = (settings?.default_deployment_method || "").trim();
    if (fromSettings === "docker_compose" || fromSettings === "kubernetes_gitops") {
        return fromSettings;
    }
    return "docker_compose";
}
/** Build PUT body from a deployment record, optionally overriding fields. */
export function deploymentToUpdateBody(deployment, overrides = {}) {
    const transport = normalizeTransportType(overrides.transport_type ?? deployment.transport_type);
    const body = {
        name: overrides.name ?? deployment.name,
        image: overrides.image ?? deployment.image,
        deployment_method: overrides.deployment_method ?? deployment.deployment_method ?? "docker_compose",
        container_port: overrides.container_port ?? deployment.container_port ?? 8080,
        mcp_path: overrides.mcp_path ?? deployment.mcp_path ?? "/mcp",
        endpoint_mode: overrides.endpoint_mode ?? deployment.endpoint_mode ?? "docker_name",
        transport_type: transport,
        env: overrides.env ?? deployment.env ?? {},
        secret_env: overrides.secret_env ?? deployment.secret_env ?? [],
        client_secret_headers: overrides.client_secret_headers ?? deployment.client_secret_headers ?? [],
        auto_register: overrides.auto_register ?? deployment.auto_register ?? true,
        auto_import_tools: overrides.auto_import_tools ?? deployment.auto_import_tools ?? true,
    };
    if ("registry_credential_id" in overrides) {
        if (overrides.registry_credential_id) {
            body.registry_credential_id = overrides.registry_credential_id;
        }
    }
    else if (deployment.registry_credential_id) {
        body.registry_credential_id = deployment.registry_credential_id;
    }
    if ("endpoint_host" in overrides) {
        if (overrides.endpoint_host)
            body.endpoint_host = overrides.endpoint_host;
    }
    else if (deployment.endpoint_host) {
        body.endpoint_host = deployment.endpoint_host;
    }
    return body;
}
/**
 * Choose logs API path based on deployment method.
 * Compose → /logs; kubernetes_gitops → /k8s/logs.
 */
export function deploymentLogsPath(deploymentId, method, tail) {
    const params = new URLSearchParams();
    if (tail && tail > 0)
        params.set("tail", String(tail));
    const qs = params.size ? `?${params}` : "";
    const id = encodeURIComponent(deploymentId);
    if (isKubernetesGitops(method)) {
        return `/api/mcp-deployments/${id}/k8s/logs${qs}`;
    }
    return `/api/mcp-deployments/${id}/logs${qs}`;
}
