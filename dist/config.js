import { homedir } from "node:os";
import { join } from "node:path";
function trimSlash(v) {
    return v.replace(/\/+$/, "");
}
function env(name, fallback = "") {
    return (process.env[name] ?? fallback).trim();
}
export function loadConfig() {
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
