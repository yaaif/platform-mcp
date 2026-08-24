import { homedir } from "node:os";
import { join } from "node:path";

export type BridgeClient = "cursor" | "codex";

export type ClientDescriptor = {
  id: BridgeClient;
  label: "Cursor" | "Codex";
  oidcClientId: string;
  stateHomeEnv: string;
  stateHomeSuffix: string;
  updatedBy: string;
};

const CLIENTS: Record<BridgeClient, ClientDescriptor> = {
  cursor: {
    id: "cursor",
    label: "Cursor",
    oidcClientId: "yaaif-cursor",
    stateHomeEnv: "YAAIF_CURSOR_HOME",
    stateHomeSuffix: "cursor",
    updatedBy: "yaaif-cursor",
  },
  codex: {
    id: "codex",
    label: "Codex",
    oidcClientId: "yaaif-codex",
    stateHomeEnv: "YAAIF_CODEX_HOME",
    stateHomeSuffix: "codex",
    updatedBy: "yaaif-codex",
  },
};

export type Config = {
  client: ClientDescriptor;
  oidcAuthority: string;
  oidcClientId: string;
  oidcScopes: string[];
  apiBaseUrl: string;
  agentBaseUrl: string;
  controlPlaneBaseUrl: string;
  approvalBaseUrl: string;
  defaultTenantId: string;
  stateHome: string;
  /** Active named profile id (hosted | local-hybrid | local | custom). */
  activeProfileId: string;
  /** Extra CA PEM file for corporate / Traefik mTLS trust. */
  extraCaFile: string;
  /** Client certificate PEM for mTLS (optional). */
  clientCertFile: string;
  /** Client private key PEM for mTLS (optional). */
  clientKeyFile: string;
};

export function clientDescriptor(client: BridgeClient): ClientDescriptor {
  return CLIENTS[client];
}

export function parseBridgeClient(argv = process.argv.slice(2)): ClientDescriptor {
  const values = argv
    .flatMap((arg, index) => {
      if (arg.startsWith("--client=")) return [arg.slice("--client=".length)];
      if (arg === "--client") return [argv[index + 1] ?? ""];
      return [];
    })
    .filter(Boolean);
  if (values.length !== 1 || (values[0] !== "cursor" && values[0] !== "codex")) {
    throw new Error("a single --client cursor|codex argument is required");
  }
  return CLIENTS[values[0]];
}

function trimSlash(v: string): string {
  return v.replace(/\/+$/, "");
}

function env(name: string, fallback = ""): string {
  const v = (process.env[name] ?? "").trim();
  // Treat empty / unexpanded plugin-variable placeholders as unset so defaults apply.
  if (!v || /^\$\{[A-Z0-9_]+\}$/.test(v)) return fallback;
  return v;
}

export function loadConfig(client = clientDescriptor("cursor")): Config {
  const scopes = env("YAAIF_OIDC_SCOPES", "openid profile email offline_access")
    .split(/\s+/)
    .filter(Boolean);
  const apiBaseUrl = trimSlash(env("YAAIF_API_BASE_URL", "https://platform.yaaif.ai"));
  return {
    client,
    oidcAuthority: trimSlash(env("YAAIF_OIDC_AUTHORITY", "https://platform.yaaif.ai/auth/realms/yaaif")),
    oidcClientId: env("YAAIF_OIDC_CLIENT_ID", client.oidcClientId),
    oidcScopes: scopes.length ? scopes : ["openid", "profile", "email", "offline_access"],
    apiBaseUrl,
    agentBaseUrl: trimSlash(env("YAAIF_AGENT_BASE_URL", `${apiBaseUrl}/agent-service`)),
    controlPlaneBaseUrl: trimSlash(
      env("YAAIF_CONTROL_PLANE_BASE_URL", `${apiBaseUrl}/control-plane-service`),
    ),
    approvalBaseUrl: trimSlash(env("YAAIF_APPROVAL_BASE_URL", `${apiBaseUrl}/approval-service`)),
    defaultTenantId: env("YAAIF_DEFAULT_TENANT_ID"),
    stateHome: env(client.stateHomeEnv, join(homedir(), ".yaaif", client.stateHomeSuffix)),
    activeProfileId: env("YAAIF_PLATFORM_PROFILE", ""),
    extraCaFile: env("YAAIF_EXTRA_CA_FILE", env("NODE_EXTRA_CA_CERTS")),
    clientCertFile: env("YAAIF_CLIENT_CERT_FILE"),
    clientKeyFile: env("YAAIF_CLIENT_KEY_FILE"),
  };
}
