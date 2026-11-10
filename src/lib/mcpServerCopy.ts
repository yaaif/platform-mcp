import type { Runtime } from "../runtime.js";

export type McpServerCopyOptions = {
  source: Runtime;
  destination: Runtime;
  serverId: string;
  newName?: string;
  newEndpoint?: string;
  dryRun: boolean;
  confirm?: boolean;
};

type HeaderMapping = {
  header_name?: string;
  credential_key?: string;
  value_prefix?: string;
};

type McpServer = {
  id?: string;
  name?: string;
  endpoint?: string;
  description?: string;
  transport_type?: string;
  timeout_seconds?: number;
  header_mappings?: HeaderMapping[];
};

type CredentialProfile = {
  profile_name?: string;
};

export async function copyMcpServer(options: McpServerCopyOptions) {
  const { source, destination, serverId, newName, newEndpoint, dryRun, confirm } = options;
  const sourceView = await source.api.agentJSON<McpServer | { server?: McpServer }>(
    "GET",
    `/api/mcp-tools/servers/${encodeURIComponent(serverId)}`,
  );
  const server = (sourceView as { server?: McpServer }).server ?? sourceView as McpServer;
  if (!server.endpoint || !server.name) throw new Error(`MCP server not found: ${serverId}`);
  const name = newName?.trim() || server.name;
  const endpoint = newEndpoint?.trim() || server.endpoint;
  const existing = await destination.api.agentJSON<{ items?: McpServer[] }>(
    "GET",
    `/api/mcp-tools/servers?q=${encodeURIComponent(endpoint)}&limit=200`,
  );
  const conflict = Boolean((existing.items ?? []).find((item) => item.endpoint === endpoint || item.name === name));
  const profiles = await source.api.agentJSON<{ items?: CredentialProfile[] }>(
    "GET",
    `/api/mcp-tools/servers/${encodeURIComponent(serverId)}/credential-profiles`,
  ).catch(() => ({ items: [] }));
  const headerMappings = (server.header_mappings ?? []).map((mapping) => ({
    header_name: mapping.header_name ?? "",
    credential_key: mapping.credential_key ?? "token",
    ...(mapping.value_prefix ? { value_prefix: mapping.value_prefix } : {}),
  })).filter((mapping) => mapping.header_name);
  const preview = {
    server_id: serverId,
    name,
    endpoint,
    transport_type: server.transport_type ?? "STREAMABLE_HTTP",
    source_profile_id: source.cfg.activeProfileId,
    destination_profile_id: destination.cfg.activeProfileId,
    conflict,
    header_mappings: headerMappings,
    credential_profiles_required: (profiles.items ?? []).map((profile) => profile.profile_name).filter(Boolean),
    credential_ids_copied: false,
    credential_mappings_copied: false,
    refresh_tools: false,
  };
  if (dryRun) return { dry_run: true, ...preview };
  if (!confirm) throw new Error("review the MCP server copy preview first, then rerun with --yes");
  if (conflict) throw new Error(`destination MCP server name or endpoint already exists: ${name} (${endpoint}); choose --new-name or --new-endpoint`);
  const created = await destination.api.agentJSON<McpServer>("POST", "/api/mcp-tools/servers", {
    name,
    description: server.description ?? "",
    endpoint,
    transport_type: server.transport_type ?? "STREAMABLE_HTTP",
    header_mappings: headerMappings,
    ...(server.timeout_seconds ? { timeout_seconds: server.timeout_seconds } : {}),
  });
  const createdId = created.id ?? name;
  const verified = await destination.api.agentJSON("GET", `/api/mcp-tools/servers/${encodeURIComponent(createdId)}`);
  return { dry_run: false, ...preview, created: { id: createdId, verified, refresh_required: true } };
}
