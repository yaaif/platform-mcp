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
  return (process.env[name] ?? fallback).trim();
}

export function loadConfig(): Config {
  const scopes = env("YAAIF_OIDC_SCOPES", "openid profile email offline_access")
    .split(/\s+/)
    .filter(Boolean);
  return {
    oidcAuthority: trimSlash(env("YAAIF_OIDC_AUTHORITY", "http://localhost:8080/auth/realms/yaaif")),
    oidcClientId: env("YAAIF_OIDC_CLIENT_ID", "yaaif-cursor"),
    oidcScopes: scopes.length ? scopes : ["openid", "profile", "email", "offline_access"],
    apiBaseUrl: trimSlash(env("YAAIF_API_BASE_URL", "http://localhost:8084")),
    agentBaseUrl: trimSlash(env("YAAIF_AGENT_BASE_URL", "http://localhost:8086")),
    defaultTenantId: env("YAAIF_DEFAULT_TENANT_ID"),
    cursorHome: env("YAAIF_CURSOR_HOME", join(homedir(), ".yaaif", "cursor")),
  };
}
