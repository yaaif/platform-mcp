import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Ctx } from "./ctx.js";
import { fail, ok } from "./helpers.js";
import {
  deploymentLogsPath,
  deploymentToUpdateBody,
  normalizeTransportType,
  resolveDeploymentMethod,
  type ClientSecretHeaderMapping,
  type DeploymentRecord,
  type DeploymentSettings,
  type SecretEnvMapping,
} from "../lib/mcpDeployments.js";

const secretEnvSchema = z.array(
  z.object({
    env_name: z.string(),
    credential_id: z.string(),
    credential_key: z.string().optional(),
  }),
);

const clientSecretHeadersSchema = z.array(
  z.object({
    header_name: z.string(),
    credential_id: z.string(),
    credential_key: z.string().optional(),
  }),
);

function mapSecretEnv(
  items: Array<{ env_name: string; credential_id: string; credential_key?: string }> | undefined,
): SecretEnvMapping[] {
  return (items ?? []).map((item) => ({
    env_name: item.env_name,
    credential_id: item.credential_id,
    credential_key: item.credential_key || "api_key",
  }));
}

function mapClientSecretHeaders(
  items:
    | Array<{ header_name: string; credential_id: string; credential_key?: string }>
    | undefined,
): ClientSecretHeaderMapping[] {
  return (items ?? []).map((item) => ({
    header_name: item.header_name,
    credential_id: item.credential_id,
    credential_key: item.credential_key || "api_key",
  }));
}

async function fetchSettings(ctx: Ctx): Promise<DeploymentSettings | null> {
  try {
    return await ctx.api.apiJSON<DeploymentSettings>("GET", "/api/deployment-settings");
  } catch {
    return null;
  }
}

/**
 * MCP deployment lifecycle + settings preflight for docker_compose and kubernetes_gitops.
 */
export function registerMcpDeploymentTools(server: McpServer, ctx: Ctx): void {
  server.registerTool("yaaif_deployment_settings_get", {
    description:
      "Read tenant deployment-service settings (default method, compose/k8s/gitops knobs). Read-only — configure GitOps/kube in Admin UI.",
    inputSchema: {},
  }, async () => {
    try {
      return ok("Fetched deployment settings.", {
        settings: await ctx.api.apiJSON("GET", "/api/deployment-settings"),
      });
    } catch (e) {
      return fail(String(e));
    }
  });

  server.registerTool("yaaif_deployment_settings_status", {
    description:
      "Preflight deployment-service health (docker / kubernetes / gitops / agent / api-server). Call before kubernetes_gitops deploy; require gitops healthy.",
    inputSchema: {},
  }, async () => {
    try {
      return ok("Fetched deployment settings status.", {
        status: await ctx.api.apiJSON("GET", "/api/deployment-settings/status"),
      });
    } catch (e) {
      return fail(String(e));
    }
  });

  server.registerTool("yaaif_mcp_deployment_create", {
    description:
      "Create an MCP deployment (docker_compose or kubernetes_gitops). transport_type must be STREAMABLE_HTTP or SSE. For k8s prefer endpoint_mode=docker_name (auto Service DNS); use custom + endpoint_host only when needed. Prefer API key secret_env over platform S2S.",
    inputSchema: {
      name: z.string(),
      image: z.string(),
      deployment_method: z.enum(["docker_compose", "kubernetes_gitops"]).optional(),
      container_port: z.number().optional(),
      mcp_path: z.string().optional(),
      endpoint_mode: z.enum(["docker_name", "localhost", "custom"]).optional(),
      endpoint_host: z.string().optional(),
      transport_type: z.enum(["STREAMABLE_HTTP", "SSE"]).optional(),
      env: z.record(z.string()).optional(),
      secret_env: secretEnvSchema.optional(),
      client_secret_headers: clientSecretHeadersSchema.optional(),
      auto_register: z.boolean().optional(),
      auto_import_tools: z.boolean().optional(),
      registry_credential_id: z.string().optional(),
	  spec_id: z.string().optional(),
	  slot_key: z.string().optional(),
	  spec_version: z.number().int().positive().optional(),
    },
  }, async (args) => {
    try {
      const settings = args.deployment_method ? null : await fetchSettings(ctx);
      const method = resolveDeploymentMethod(args.deployment_method, settings);
      const body: Record<string, unknown> = {
        name: args.name,
        image: args.image,
        deployment_method: method,
        container_port: args.container_port ?? 8080,
        mcp_path: args.mcp_path || "/mcp",
        endpoint_mode: args.endpoint_mode || "docker_name",
        transport_type: normalizeTransportType(args.transport_type),
        env: args.env ?? {},
        secret_env: mapSecretEnv(args.secret_env),
        client_secret_headers: mapClientSecretHeaders(args.client_secret_headers),
        auto_register: args.auto_register ?? true,
        auto_import_tools: args.auto_import_tools ?? true,
      };
      if (args.endpoint_host) body.endpoint_host = args.endpoint_host;
      if (args.registry_credential_id) body.registry_credential_id = args.registry_credential_id;
      const deployment = await ctx.api.apiJSON<DeploymentRecord>("POST", "/api/mcp-deployments", body);
	  let scenario_binding: unknown;
	  if (args.spec_id && args.slot_key && args.spec_version && deployment.external_mcp_server_id) {
		scenario_binding = await ctx.api.agentJSON("POST", `/api/agent-specs/${encodeURIComponent(args.spec_id)}/bindings`, {
		  expected_version: args.spec_version,
		  slot_key: args.slot_key,
		  kind: "mcp_server",
		  entity_id: deployment.external_mcp_server_id,
		  entity_name: args.name,
		  source: "cursor_plugin",
		});
	  } else if (args.spec_id && args.slot_key) {
		scenario_binding = {
		  pending: true, spec_id: args.spec_id, slot_key: args.slot_key, spec_version: args.spec_version,
		  reason: "Pass this Scenario context to yaaif_mcp_deployment_register after the MCP server is registered.",
		};
	  }
	  return ok(`Created MCP deployment ${args.name} (${method}).`, {
        deployment,
		...(scenario_binding ? { scenario_binding } : {}),
        deployment_method: method,
        next_steps:
          method === "kubernetes_gitops"
            ? [
                "Confirm yaaif_deployment_settings_status gitops is healthy",
                "yaaif_mcp_deployment_deploy then poll status + yaaif_mcp_deployment_k8s_status",
                "yaaif_mcp_deployment_logs (routes to /k8s/logs)",
              ]
            : [
                "yaaif_mcp_deployment_deploy then poll status",
                "yaaif_mcp_deployment_logs",
                "yaaif_mcp_deployment_register if needed",
              ],
      });
    } catch (e) {
      return fail(String(e));
    }
  });

  server.registerTool("yaaif_mcp_deployment_update", {
    description:
      "Update an MCP deployment (image/env/secret_env/endpoint/…). GETs current record, merges patches, PUTs. Call yaaif_mcp_deployment_redeploy afterward for rollout.",
    inputSchema: {
      deployment_id: z.string(),
      name: z.string().optional(),
      image: z.string().optional(),
      deployment_method: z.enum(["docker_compose", "kubernetes_gitops"]).optional(),
      container_port: z.number().optional(),
      mcp_path: z.string().optional(),
      endpoint_mode: z.enum(["docker_name", "localhost", "custom"]).optional(),
      endpoint_host: z.string().optional(),
      clear_endpoint_host: z.boolean().optional(),
      transport_type: z.enum(["STREAMABLE_HTTP", "SSE"]).optional(),
      env: z.record(z.string()).optional(),
      secret_env: secretEnvSchema.optional(),
      client_secret_headers: clientSecretHeadersSchema.optional(),
      auto_register: z.boolean().optional(),
      auto_import_tools: z.boolean().optional(),
      registry_credential_id: z.string().optional(),
      clear_registry_credential_id: z.boolean().optional(),
    },
  }, async (args) => {
    try {
      const deployment = await ctx.api.apiJSON<DeploymentRecord>(
        "GET",
        `/api/mcp-deployments/${encodeURIComponent(args.deployment_id)}`,
      );
      const overrides: import("../lib/mcpDeployments.js").DeploymentUpdateOverrides = {};
      if (args.name !== undefined) overrides.name = args.name;
      if (args.image !== undefined) overrides.image = args.image;
      if (args.deployment_method !== undefined) overrides.deployment_method = args.deployment_method;
      if (args.container_port !== undefined) overrides.container_port = args.container_port;
      if (args.mcp_path !== undefined) overrides.mcp_path = args.mcp_path;
      if (args.endpoint_mode !== undefined) overrides.endpoint_mode = args.endpoint_mode;
      if (args.clear_endpoint_host) overrides.endpoint_host = null;
      else if (args.endpoint_host !== undefined) overrides.endpoint_host = args.endpoint_host;
      if (args.transport_type !== undefined) overrides.transport_type = args.transport_type;
      if (args.env !== undefined) overrides.env = args.env;
      if (args.secret_env !== undefined) overrides.secret_env = mapSecretEnv(args.secret_env);
      if (args.client_secret_headers !== undefined) {
        overrides.client_secret_headers = mapClientSecretHeaders(args.client_secret_headers);
      }
      if (args.auto_register !== undefined) overrides.auto_register = args.auto_register;
      if (args.auto_import_tools !== undefined) overrides.auto_import_tools = args.auto_import_tools;
      if (args.clear_registry_credential_id) overrides.registry_credential_id = null;
      else if (args.registry_credential_id !== undefined) {
        overrides.registry_credential_id = args.registry_credential_id;
      }

      const body = deploymentToUpdateBody(deployment, overrides);
      return ok("Updated MCP deployment.", {
        deployment: await ctx.api.apiJSON(
          "PUT",
          `/api/mcp-deployments/${encodeURIComponent(args.deployment_id)}`,
          body,
        ),
        next_steps: ["Call yaaif_mcp_deployment_redeploy (or deploy) to apply changes"],
      });
    } catch (e) {
      return fail(String(e));
    }
  });

  server.registerTool("yaaif_mcp_deployment_deploy", {
    description:
      "Deploy an MCP deployment by id (compose up, or GitOps overlay write/push for kubernetes_gitops).",
    inputSchema: { deployment_id: z.string() },
  }, async ({ deployment_id }) => {
    try {
      return ok("Deploy started/updated.", {
        deployment: await ctx.api.apiJSON(
          "POST",
          `/api/mcp-deployments/${encodeURIComponent(deployment_id)}/deploy`,
          {},
        ),
      });
    } catch (e) {
      return fail(String(e));
    }
  });

  server.registerTool("yaaif_mcp_deployment_redeploy", {
    description:
      "Roll out an existing MCP deployment (compose recreate or k8s restart/GitOps sync). Use after update or secret_env bind.",
    inputSchema: { deployment_id: z.string() },
  }, async ({ deployment_id }) => {
    try {
      return ok("Redeploy started.", {
        deployment: await ctx.api.apiJSON(
          "POST",
          `/api/mcp-deployments/${encodeURIComponent(deployment_id)}/redeploy`,
          {},
        ),
      });
    } catch (e) {
      return fail(String(e));
    }
  });

  server.registerTool("yaaif_mcp_deployment_stop", {
    description: "Stop an MCP deployment (compose stop or k8s scale-down via GitOps).",
    inputSchema: { deployment_id: z.string() },
  }, async ({ deployment_id }) => {
    try {
      return ok("Stop requested.", {
        deployment: await ctx.api.apiJSON(
          "POST",
          `/api/mcp-deployments/${encodeURIComponent(deployment_id)}/stop`,
          {},
        ),
      });
    } catch (e) {
      return fail(String(e));
    }
  });

  server.registerTool("yaaif_mcp_deployment_delete", {
    description:
      "Delete an MCP deployment. cascade_agent=true (default) also removes the linked agent-service MCP server/tools.",
    inputSchema: {
      deployment_id: z.string(),
      cascade_agent: z.boolean().optional(),
    },
  }, async ({ deployment_id, cascade_agent }) => {
    const cascade = cascade_agent !== false;
    const params = new URLSearchParams({ cascade_agent: cascade ? "true" : "false" });
    try {
      await ctx.api.apiJSON(
        "DELETE",
        `/api/mcp-deployments/${encodeURIComponent(deployment_id)}?${params}`,
      );
      return ok(`Deleted MCP deployment ${deployment_id}.`, {
        deployment_id,
        cascade_agent: cascade,
      });
    } catch (e) {
      return fail(String(e));
    }
  });

  server.registerTool("yaaif_mcp_deployment_register", {
    description: "Register a deployed MCP server into the agent-service tool catalog.",
    inputSchema: { deployment_id: z.string(), spec_id: z.string().optional(), slot_key: z.string().optional(), spec_version: z.number().int().positive().optional() },
  }, async ({ deployment_id, spec_id, slot_key, spec_version }) => {
    try {
      const deployment = await ctx.api.apiJSON<DeploymentRecord>(
        "POST",
        `/api/mcp-deployments/${encodeURIComponent(deployment_id)}/register`,
        {},
      );
	  let scenario_binding: unknown;
	  if (spec_id && slot_key && spec_version) {
		if (!deployment.external_mcp_server_id) {
		  return fail("MCP deployment registered but did not return an external MCP server id; retry status/register before binding.", { deployment });
		}
		scenario_binding = await ctx.api.agentJSON("POST", `/api/agent-specs/${encodeURIComponent(spec_id)}/bindings`, {
		  expected_version: spec_version, slot_key, kind: "mcp_server", entity_id: deployment.external_mcp_server_id,
		  entity_name: deployment.name || deployment_id, source: "cursor_plugin",
		});
	  }
      return ok("Registered MCP deployment into catalog.", {
        deployment,
		...(scenario_binding ? { scenario_binding } : {}),
      });
    } catch (e) {
      return fail(String(e));
    }
  });

  server.registerTool("yaaif_mcp_deployment_status", {
    description:
      "Get MCP deployment status (phase, status_stages, generated_endpoint, kubernetes_namespace, overlay/compose paths).",
    inputSchema: { deployment_id: z.string() },
  }, async ({ deployment_id }) => {
    try {
      return ok("Fetched MCP deployment.", {
        deployment: await ctx.api.apiJSON(
          "GET",
          `/api/mcp-deployments/${encodeURIComponent(deployment_id)}`,
        ),
      });
    } catch (e) {
      return fail(String(e));
    }
  });

  server.registerTool("yaaif_mcp_deployment_logs", {
    description:
      "Fetch MCP deployment logs. Routes automatically: docker_compose → /logs; kubernetes_gitops → /k8s/logs.",
    inputSchema: { deployment_id: z.string(), tail: z.number().optional() },
  }, async ({ deployment_id, tail }) => {
    try {
      const deployment = await ctx.api.apiJSON<DeploymentRecord>(
        "GET",
        `/api/mcp-deployments/${encodeURIComponent(deployment_id)}`,
      );
      const method = deployment.deployment_method;
      const path = deploymentLogsPath(deployment_id, method, tail);
      const logs = await ctx.api.apiJSON("GET", path);
      return ok("Fetched MCP deployment logs.", {
        logs,
        deployment_method: method,
        source: isK8s(method) ? "k8s" : "docker_compose",
      });
    } catch (e) {
      return fail(String(e));
    }
  });

  server.registerTool("yaaif_mcp_deployment_k8s_status", {
    description:
      "Kubernetes runtime introspection for a kubernetes_gitops deployment (pod + Deployment status). Returns clear error if K8s integration is disabled.",
    inputSchema: { deployment_id: z.string() },
  }, async ({ deployment_id }) => {
    const id = encodeURIComponent(deployment_id);
    const out: Record<string, unknown> = {};
    const errors: Record<string, string> = {};
    const load = async (key: string, path: string) => {
      try {
        out[key] = await ctx.api.apiJSON("GET", path);
      } catch (e) {
        errors[key] = String(e);
      }
    };
    await Promise.all([
      load("pod", `/api/mcp-deployments/${id}/k8s/pod`),
      load("deployment", `/api/mcp-deployments/${id}/k8s/deployment`),
    ]);
    if (Object.keys(errors).length && Object.keys(out).length === 0) {
      return fail(
        `Kubernetes status unavailable (is DEPLOYMENT_KUBERNETES_ENABLED set?). ${Object.values(errors).join("; ")}`,
      );
    }
    return ok("Fetched Kubernetes deployment status.", {
      ...out,
      ...(Object.keys(errors).length ? { errors } : {}),
    });
  });

  server.registerTool("yaaif_mcp_deployments_list", {
    description: "List MCP deployments (api-server / deployment-service).",
    inputSchema: { q: z.string().optional(), limit: z.number().optional() },
  }, async ({ q, limit }) => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (limit) params.set("limit", String(limit));
    const path = `/api/mcp-deployments${params.size ? `?${params}` : ""}`;
    try {
      return ok("Listed MCP deployments.", { result: await ctx.api.apiJSON("GET", path) });
    } catch (e) {
      return fail(String(e));
    }
  });
}

function isK8s(method?: string): boolean {
  return (method || "").trim() === "kubernetes_gitops";
}
