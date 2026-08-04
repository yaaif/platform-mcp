function isTenantBootstrapPath(path) {
    return (path.startsWith("/api/users/me/tenants") ||
        path.startsWith("/api/rbac/me") ||
        path.startsWith("/api/users/me/last-tenant") ||
        path.startsWith("/api/users/me/active-tenant"));
}
export class ApiClient {
    cfg;
    auth;
    constructor(cfg, auth) {
        this.cfg = cfg;
        this.auth = auth;
    }
    agentJSON(method, path, body) {
        return this.doJSON(this.cfg.agentBaseUrl, method, path, body);
    }
    apiJSON(method, path, body) {
        return this.doJSON(this.cfg.apiBaseUrl, method, path, body);
    }
    controlPlaneJSON(method, path, body) {
        return this.doJSON(this.cfg.controlPlaneBaseUrl, method, path, body);
    }
    approvalJSON(method, path, body) {
        return this.doJSON(this.cfg.approvalBaseUrl, method, path, body);
    }
    async doJSON(base, method, path, body) {
        const { token, session } = await this.auth.accessToken();
        const tenantId = (session.tenant_id || this.cfg.defaultTenantId || "").trim();
        if (!tenantId && !isTenantBootstrapPath(path)) {
            throw new Error("tenant not set; call yaaif_set_tenant or set YAAIF_DEFAULT_TENANT_ID");
        }
        const headers = {
            Authorization: `Bearer ${token}`,
            Accept: "application/json",
        };
        if (tenantId)
            headers["X-Tenant-ID"] = tenantId;
        let payload;
        if (body !== undefined) {
            headers["Content-Type"] = "application/json";
            payload = JSON.stringify(body);
        }
        const res = await fetch(`${base}${path.startsWith("/") ? path : `/${path}`}`, {
            method,
            headers,
            body: payload,
        });
        const text = await res.text();
        if (!res.ok) {
            throw new Error(`${method} ${path} failed (${res.status}): ${text.trim()}`);
        }
        if (!text.trim() || res.status === 204)
            return undefined;
        return JSON.parse(text);
    }
}
