import { encodeMultipart } from "../lib/toolPackageInspect.js";
import { yaaifFetch } from "./tls.js";
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
    agentJSON(method, path, body, opts) {
        return this.doJSON(this.cfg.agentBaseUrl, method, path, body, opts);
    }
    apiJSON(method, path, body, opts) {
        return this.doJSON(this.cfg.apiBaseUrl, method, path, body, opts);
    }
    controlPlaneJSON(method, path, body, opts) {
        return this.doJSON(this.cfg.controlPlaneBaseUrl, method, path, body, opts);
    }
    approvalJSON(method, path, body, opts) {
        return this.doJSON(this.cfg.approvalBaseUrl, method, path, body, opts);
    }
    apiForm(method, path, fields, file, opts) {
        return this.doForm(this.cfg.apiBaseUrl, method, path, fields, file, opts);
    }
    async authHeaders(path) {
        const { token, session } = await this.auth.accessToken();
        const tenantId = (session.tenant_id || this.cfg.defaultTenantId || "").trim();
        if (!tenantId && !isTenantBootstrapPath(path)) {
            throw new Error("tenant not set; call yaaif_set_tenant (name/slug/uuid) or yaaif_ensure_session");
        }
        const headers = {
            Authorization: `Bearer ${token}`,
            Accept: "application/json",
        };
        if (tenantId)
            headers["X-Tenant-ID"] = tenantId;
        return headers;
    }
    async doJSON(base, method, path, body, opts) {
        const headers = await this.authHeaders(path);
        let payload;
        if (body !== undefined) {
            headers["Content-Type"] = "application/json";
            payload = JSON.stringify(body);
        }
        return this.parseJSON(method, path, await yaaifFetch(`${base}${path.startsWith("/") ? path : `/${path}`}`, {
            method,
            headers,
            body: payload,
            timeoutMs: opts?.timeoutMs,
        }));
    }
    async doForm(base, method, path, fields, file, opts) {
        const headers = await this.authHeaders(path);
        const encoded = encodeMultipart(fields, {
            field: file.field || "file",
            filename: file.filename,
            body: file.body,
            contentType: file.contentType,
        });
        headers["Content-Type"] = encoded.contentType;
        return this.parseJSON(method, path, await yaaifFetch(`${base}${path.startsWith("/") ? path : `/${path}`}`, {
            method,
            headers,
            body: encoded.buffer,
            timeoutMs: opts?.timeoutMs ?? 5 * 60 * 1000,
        }));
    }
    async parseJSON(method, path, res) {
        const text = await res.text();
        if (!res.ok) {
            throw new Error(`${method} ${path} failed (${res.status}): ${text.trim()}`);
        }
        if (!text.trim() || res.status === 204)
            return undefined;
        return JSON.parse(text);
    }
}
