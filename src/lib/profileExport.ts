import type { Config } from "../config.js";

export function exportProfileEnv(cfg: Config): {
  shell: string;
  cursor_plugin_variables: Record<string, string>;
} {
  const vars: Record<string, string> = {
    YAAIF_PLATFORM_PROFILE: cfg.activeProfileId || "",
    YAAIF_OIDC_AUTHORITY: cfg.oidcAuthority,
    YAAIF_OIDC_CLIENT_ID: cfg.oidcClientId,
    YAAIF_API_BASE_URL: cfg.apiBaseUrl,
    YAAIF_AGENT_BASE_URL: cfg.agentBaseUrl,
    YAAIF_CONTROL_PLANE_BASE_URL: cfg.controlPlaneBaseUrl,
    YAAIF_APPROVAL_BASE_URL: cfg.approvalBaseUrl,
  };
  if (cfg.defaultTenantId) vars.YAAIF_DEFAULT_TENANT_ID = cfg.defaultTenantId;
  if (cfg.extraCaFile) vars.YAAIF_EXTRA_CA_FILE = cfg.extraCaFile;
  if (cfg.clientCertFile) vars.YAAIF_CLIENT_CERT_FILE = cfg.clientCertFile;
  if (cfg.clientKeyFile) vars.YAAIF_CLIENT_KEY_FILE = cfg.clientKeyFile;

  const shell = Object.entries(vars)
    .filter(([, v]) => v)
    .map(([k, v]) => `export ${k}=${shellQuote(v)}`)
    .join("\n");

  return { shell, cursor_plugin_variables: vars };
}

function shellQuote(v: string): string {
  if (/^[A-Za-z0-9_./:@%-]+$/.test(v)) return v;
  return `'${v.replace(/'/g, `'\\''`)}'`;
}
