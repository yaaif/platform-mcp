import { homedir } from "node:os";
import { join } from "node:path";

export type Config = {
  oidcAuthority: string;
  oidcClientId: string;
  oidcScopes: string[];
  apiBaseUrl: string;
  agentBaseUrl: string;
  defaultTenantId: string;
  cursorHome: string;
};

function trimSlash(v: string): string {
  return v.replace(/\/+$/, "");
}

function env(name: string, fallback = ""): string {
  const v = (process.env[name] ?? "").trim();
  // Treat empty / unexpanded plugin-variable placeholders as unset so defaults apply.
  if (!v || /^\$\{[A-Z0-9_]+\}$/.test(v)) return fallback;
  return v;
}

export function loadConfig(): Config {
  const scopes = env("YAAIF_OIDC_SCOPES", "openid profile email offline_access")
    .split(/\s+/)
    .filter(Boolean);
  return {
    oidcAuthority: trimSlash(env("YAAIF_OIDC_AUTHORITY", "https://platform.yaaif.ai/auth/realms/yaaif")),
    oidcClientId: env("YAAIF_OIDC_CLIENT_ID", "yaaif-cursor"),
    oidcScopes: scopes.length ? scopes : ["openid", "profile", "email", "offline_access"],
    apiBaseUrl: trimSlash(env("YAAIF_API_BASE_URL", "https://platform.yaaif.ai")),
    agentBaseUrl: trimSlash(env("YAAIF_AGENT_BASE_URL", "https://platform.yaaif.ai/agent-service")),
    defaultTenantId: env("YAAIF_DEFAULT_TENANT_ID"),
    cursorHome: env("YAAIF_CURSOR_HOME", join(homedir(), ".yaaif", "cursor")),
  };
}
