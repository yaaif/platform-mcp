import type { ApiClient } from "../client/http.js";

export type FeatureStatus = "available" | "permission_denied" | "unavailable" | "error";
export type FeatureId = "agents" | "scenarios" | "credentials" | "wiki" | "platform_updates";

export type FeatureCapability = {
  status: FeatureStatus;
  supported: boolean;
  accessible: boolean;
  permission: string;
  http_status?: number;
  error?: string;
  hint?: string;
};

type Definition = {
  service: "agent" | "api";
  path: string;
  permission: string;
  unavailableHint: string;
};

const DEFINITIONS: Record<FeatureId, Definition> = {
  agents: {
    service: "agent",
    path: "/api/agents?limit=1",
    permission: "agent.agents.read",
    unavailableHint: "Upgrade agent-service so the agent catalog is available.",
  },
  scenarios: {
    service: "agent",
    path: "/api/agent-specs?limit=1",
    permission: "agent.specs.read",
    unavailableHint: "Upgrade agent-service so Scenario (Agent Spec) APIs are available.",
  },
  credentials: {
    service: "api",
    path: "/api/credentials?limit=1",
    permission: "api.credentials.read",
    unavailableHint: "Upgrade api-server so Credentials APIs are available.",
  },
  wiki: {
    service: "api",
    path: "/api/wiki/pages?limit=1",
    permission: "agent.memory.read",
    unavailableHint: "Upgrade api-server so Wiki APIs are available.",
  },
  platform_updates: {
    service: "api",
    path: "/api/platform-updates/status",
    permission: "api.installation.read",
    unavailableHint: "Upgrade api-server/update-service so platform release status is available.",
  },
};

function httpStatus(error: unknown): number | undefined {
  const match = String(error).match(/\((\d{3})\)/);
  return match ? Number(match[1]) : undefined;
}

export async function probeFeature(api: ApiClient, id: FeatureId): Promise<FeatureCapability> {
  const definition = DEFINITIONS[id];
  try {
    if (definition.service === "agent") await api.agentJSON("GET", definition.path);
    else await api.apiJSON("GET", definition.path);
    return { status: "available", supported: true, accessible: true, permission: definition.permission };
  } catch (error) {
    const status = httpStatus(error);
    const message = String(error).slice(0, 240);
    if (status === 401 || status === 403) {
      return {
        status: "permission_denied",
        supported: true,
        accessible: false,
        permission: definition.permission,
        http_status: status,
        error: message,
        hint: `Backend route exists; grant ${definition.permission} to use this feature.`,
      };
    }
    if (status === 404 || status === 405 || status === 501) {
      return {
        status: "unavailable",
        supported: false,
        accessible: false,
        permission: definition.permission,
        http_status: status,
        error: message,
        hint: definition.unavailableHint,
      };
    }
    return {
      status: "error",
      supported: false,
      accessible: false,
      permission: definition.permission,
      ...(status ? { http_status: status } : {}),
      error: message,
      hint: "Feature probe failed; inspect connectivity and service health before retrying.",
    };
  }
}

export async function collectFeatureCapabilities(api: ApiClient) {
  const ids = Object.keys(DEFINITIONS) as FeatureId[];
  const entries = await Promise.all(ids.map(async (id) => [id, await probeFeature(api, id)] as const));
  const features = Object.fromEntries(entries) as Record<FeatureId, FeatureCapability>;
  const values = Object.values(features);
  return {
    all_supported: values.every((feature) => feature.supported),
    all_accessible: values.every((feature) => feature.accessible),
    features,
  };
}
