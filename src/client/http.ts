import type { AuthClient } from "../auth/oidc.js";
import type { Config } from "../config.js";

function isTenantBootstrapPath(path: string): boolean {
  return (
    path.startsWith("/api/users/me/tenants") ||
    path.startsWith("/api/rbac/me") ||
    path.startsWith("/api/users/me/last-tenant") ||
    path.startsWith("/api/users/me/active-tenant")
  );
}

export class ApiClient {
  constructor(
    readonly cfg: Config,
    private readonly auth: AuthClient,
  ) {}

  agentJSON<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
    return this.doJSON<T>(this.cfg.agentBaseUrl, method, path, body);
  }

  apiJSON<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
    return this.doJSON<T>(this.cfg.apiBaseUrl, method, path, body);
  }

  controlPlaneJSON<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
    return this.doJSON<T>(this.cfg.controlPlaneBaseUrl, method, path, body);
  }

  approvalJSON<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
    return this.doJSON<T>(this.cfg.approvalBaseUrl, method, path, body);
  }

  private async doJSON<T>(base: string, method: string, path: string, body?: unknown): Promise<T> {
    const { token, session } = await this.auth.accessToken();
    const tenantId = (session.tenant_id || this.cfg.defaultTenantId || "").trim();
    if (!tenantId && !isTenantBootstrapPath(path)) {
      throw new Error("tenant not set; call yaaif_set_tenant or set YAAIF_DEFAULT_TENANT_ID");
    }
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    };
    if (tenantId) headers["X-Tenant-ID"] = tenantId;
    let payload: string | undefined;
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
    if (!text.trim() || res.status === 204) return undefined as T;
    return JSON.parse(text) as T;
  }
}
