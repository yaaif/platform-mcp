import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AuthClient } from "../auth/oidc.js";
import type { ApiClient } from "../client/http.js";
import type { Config } from "../config.js";
import { fail, ok } from "./helpers.js";
import { cpSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

export type Ctx = { cfg: Config; auth: AuthClient; api: ApiClient };

export function registerAllTools(server: McpServer, ctx: Ctx): void {
  registerAuth(server, ctx);
  registerSkills(server, ctx);
  registerAmbient(server, ctx);
  registerMcp(server, ctx);
}

function registerAuth(server: McpServer, ctx: Ctx): void {
  server.registerTool("yaaif_configure_check", {
    description: "Validate plugin env URLs, auth session, and API/agent reachability.",
    inputSchema: {},
  }, async () => {
    const sess = await ctx.auth.session();
    const out: Record<string, unknown> = {
      oidc_authority: ctx.cfg.oidcAuthority,
      api_base: ctx.cfg.apiBaseUrl,
      agent_base: ctx.cfg.agentBaseUrl,
      client_id: ctx.cfg.oidcClientId,
      authenticated: Boolean(sess?.tokens.access_token),
      tenant_id: sess?.tenant_id || ctx.cfg.defaultTenantId || "",
    };
    try {
      const healthApi = await fetch(`${ctx.cfg.apiBaseUrl}/health`);
      out.api_health = healthApi.status;
    } catch (e) {
      out.api_health_error = String(e);
    }
    try {
      const healthAgent = await fetch(`${ctx.cfg.agentBaseUrl}/health`);
      out.agent_health = healthAgent.status;
    } catch (e) {
      out.agent_health_error = String(e);
    }
    if (sess?.tokens.access_token) {
      try {
        out.rbac_me = await ctx.api.apiJSON("GET", "/api/rbac/me");
      } catch (e) {
        out.rbac_error = String(e);
      }
    }
    return ok("Configuration check complete.", out);
  });

  server.registerTool("yaaif_login", {
    description: "Open browser PKCE login against YAAIF Keycloak and persist tokens.",
    inputSchema: {},
  }, async () => {
    try {
      const sess = await ctx.auth.login();
      return ok("Logged in to YAAIF.", {
        email: sess.email,
        name: sess.name,
        subject: sess.subject,
        tenant_id: sess.tenant_id,
        expires: sess.tokens.expiry,
      });
    } catch (e) {
      return fail(String(e));
    }
  });

  server.registerTool("yaaif_logout", {
    description: "Clear the local YAAIF Cursor session.",
    inputSchema: {},
  }, async () => {
    await ctx.auth.logout();
    return ok("Logged out.", { logged_out: true });
  });

  server.registerTool("yaaif_whoami", {
    description: "Return current auth session, RBAC identity, and active tenant.",
    inputSchema: {},
  }, async () => {
    const sess = await ctx.auth.session();
    if (!sess?.tokens.access_token) return ok("Not authenticated.", { authenticated: false });
    let me: unknown;
    let tenants: unknown;
    try { me = await ctx.api.apiJSON("GET", "/api/rbac/me"); } catch { /* optional */ }
    try { tenants = await ctx.api.apiJSON("GET", "/api/users/me/tenants"); } catch { /* optional */ }
    return ok("Authenticated YAAIF session.", {
      authenticated: true,
      email: sess.email,
      name: sess.name,
      subject: sess.subject,
      tenant_id: sess.tenant_id || ctx.cfg.defaultTenantId || "",
      expires: sess.tokens.expiry,
      rbac_me: me,
      tenants,
      api_base: ctx.cfg.apiBaseUrl,
      agent_base: ctx.cfg.agentBaseUrl,
    });
  });

  server.registerTool("yaaif_list_tenants", {
    description: "List tenants available to the signed-in user.",
    inputSchema: {},
  }, async () => {
    try {
      const tenants = await ctx.api.apiJSON("GET", "/api/users/me/tenants");
      return ok("Listed tenants.", { tenants });
    } catch (e) {
      return fail(String(e));
    }
  });

  server.registerTool("yaaif_set_tenant", {
    description: "Set the active tenant id for subsequent YAAIF API calls.",
    inputSchema: { tenant_id: z.string() },
  }, async ({ tenant_id }) => {
    try {
      const sess = await ctx.auth.setTenant(tenant_id);
      try {
        await ctx.api.apiJSON("POST", "/api/users/me/active-tenant", { tenant_id });
      } catch { /* best-effort */ }
      return ok(`Active tenant set to ${tenant_id}.`, { tenant_id: sess.tenant_id, email: sess.email });
    } catch (e) {
      return fail(String(e));
    }
  });
}

function registerSkills(server: McpServer, ctx: Ctx): void {
  server.registerTool("yaaif_skill_list", {
    description: "List skills in the tenant catalog.",
    inputSchema: { q: z.string().optional(), limit: z.number().optional() },
  }, async ({ q, limit }) => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (limit) params.set("limit", String(limit));
    const path = `/api/skills${params.size ? `?${params}` : ""}`;
    try {
      return ok("Listed skills.", { result: await ctx.api.agentJSON("GET", path) });
    } catch (e) { return fail(String(e)); }
  });

  server.registerTool("yaaif_skill_get", {
    description: "Get one skill by id.",
    inputSchema: { skill_id: z.string() },
  }, async ({ skill_id }) => {
    try {
      return ok("Fetched skill.", { skill: await ctx.api.agentJSON("GET", `/api/skills/${encodeURIComponent(skill_id)}`) });
    } catch (e) { return fail(String(e)); }
  });

  server.registerTool("yaaif_skill_create", {
    description: "Create a skill pack in YAAIF (writes SKILL.md + skill_configs).",
    inputSchema: {
      id: z.string(),
      description: z.string(),
      instruction: z.string(),
      name: z.string().optional(),
      tools: z.array(z.string()).optional(),
      allowed_tools: z.array(z.string()).optional(),
      classification: z.string().optional(),
      enabled: z.boolean().optional(),
      updated_by: z.string().optional(),
      assigned_user_emails: z.array(z.string()).optional(),
      include_references: z.boolean().optional(),
      include_examples: z.boolean().optional(),
    },
  }, async (args) => {
    const name = args.name || args.id.split("/").pop() || args.id;
    const tools = args.tools ?? [];
    const body = {
      id: args.id,
      name,
      description: args.description,
      instruction: args.instruction,
      tools,
      allowed_tools: args.allowed_tools ?? tools,
      classification: args.classification || "general",
      enabled: args.enabled ?? true,
      updated_by: args.updated_by || "yaaif-cursor",
      assigned_user_emails: args.assigned_user_emails ?? [],
      scaffold: {
        include_references: args.include_references ?? true,
        include_examples: args.include_examples ?? true,
      },
    };
    try {
      return ok(`Created skill ${args.id}.`, { skill: await ctx.api.agentJSON("POST", "/api/skills", body) });
    } catch (e) { return fail(String(e)); }
  });

  server.registerTool("yaaif_skill_write_file", {
    description: "Create or update a skill pack file under the tenant skills tree.",
    inputSchema: {
      path: z.string(),
      content: z.string(),
      method: z.enum(["POST", "PUT"]).optional(),
    },
  }, async ({ path, content, method }) => {
    try {
      const result = await ctx.api.agentJSON(method || "PUT", "/api/skill-files/content", { path, content });
      return ok(`Wrote skill file ${path}.`, { result });
    } catch (e) { return fail(String(e)); }
  });

  server.registerTool("yaaif_skill_enable", {
    description: "Enable or disable a skill in skill_configs.",
    inputSchema: {
      skill_id: z.string(),
      enabled: z.boolean(),
      updated_by: z.string().optional(),
    },
  }, async ({ skill_id, enabled, updated_by }) => {
    try {
      const skill = await ctx.api.agentJSON("POST", "/api/skills/enablement", {
        skill_id, enabled, updated_by: updated_by || "yaaif-cursor",
      });
      return ok(`Skill ${skill_id} enabled=${enabled}.`, { skill });
    } catch (e) { return fail(String(e)); }
  });

  server.registerTool("yaaif_skill_map_agents", {
    description: "Replace agent→skill mappings (bulk).",
    inputSchema: {
      assignments: z.array(z.object({
        agent_id: z.string(),
        skill_ids: z.array(z.string()),
      })),
    },
  }, async ({ assignments }) => {
    try {
      const result = await ctx.api.agentJSON("POST", "/api/agents/skills/bulk", { assignments });
      return ok("Updated agent skill mappings.", { result });
    } catch (e) { return fail(String(e)); }
  });

  server.registerTool("yaaif_skill_validate", {
    description: "Validate one skill or the catalog.",
    inputSchema: { skill_id: z.string().optional(), strict: z.boolean().optional() },
  }, async ({ skill_id, strict }) => {
    try {
      const body: Record<string, unknown> = { strict: strict ?? false };
      if (skill_id) body.skill_id = skill_id;
      return ok("Validated skills.", { result: await ctx.api.agentJSON("POST", "/api/skills/validate", body) });
    } catch (e) { return fail(String(e)); }
  });

  server.registerTool("yaaif_skill_refresh", {
    description: "Re-discover skill files into the catalog.",
    inputSchema: {},
  }, async () => {
    try {
      return ok("Refreshed skill catalog.", { result: await ctx.api.agentJSON("POST", "/api/skills/refresh", {}) });
    } catch (e) { return fail(String(e)); }
  });

  server.registerTool("yaaif_skill_runtime_reload", {
    description: "Reload in-memory skill runtime for agents.",
    inputSchema: {},
  }, async () => {
    try {
      return ok("Reloaded skill runtime.", { result: await ctx.api.agentJSON("POST", "/api/skills/runtime-reload", {}) });
    } catch (e) { return fail(String(e)); }
  });
}

function registerAmbient(server: McpServer, ctx: Ctx): void {
  server.registerTool("yaaif_agent_create", {
    description: "Create a chat or workflow agent definition.",
    inputSchema: {
      name: z.string(),
      description: z.string(),
      goal_prompt: z.string(),
      agent_type: z.string().optional(),
      skill_ids: z.array(z.string()).optional(),
      enabled: z.boolean().optional(),
    },
  }, async (args) => {
    const body: Record<string, unknown> = {
      name: args.name,
      description: args.description,
      goal_prompt: args.goal_prompt,
      skill_ids: args.skill_ids ?? [],
      enabled: args.enabled ?? true,
    };
    if (args.agent_type) body.agent_type = args.agent_type;
    try {
      return ok(`Created agent ${args.name}.`, { agent: await ctx.api.agentJSON("POST", "/api/agents", body) });
    } catch (e) { return fail(String(e)); }
  });

  server.registerTool("yaaif_ambient_agent_create", {
    description: "Create an ambient agent config linked to a workflow agent.",
    inputSchema: {
      name: z.string(),
      agent_id: z.string(),
      description: z.string().optional(),
      enabled: z.boolean().optional(),
      mode: z.string().optional(),
      workflow_async_enabled: z.boolean().optional(),
      requires_approval: z.boolean().optional(),
      policy: z.record(z.unknown()).optional(),
    },
  }, async (args) => {
    const body: Record<string, unknown> = {
      name: args.name,
      description: args.description ?? "",
      agent_id: args.agent_id,
      enabled: args.enabled ?? true,
      mode: args.mode || "active",
      workflow_async_enabled: args.workflow_async_enabled ?? true,
      requires_approval: args.requires_approval ?? false,
    };
    if (args.policy) body.policy = args.policy;
    try {
      return ok(`Created ambient agent ${args.name}.`, {
        ambient_agent: await ctx.api.agentJSON("POST", "/api/ambient/agents", body),
      });
    } catch (e) { return fail(String(e)); }
  });

  server.registerTool("yaaif_ambient_workflow_create", {
    description: "Install an ambient workflow graph under an ambient agent.",
    inputSchema: {
      ambient_agent_id: z.string(),
      name: z.string(),
      workflow_graph: z.record(z.unknown()),
      description: z.string().optional(),
      enabled: z.boolean().optional(),
      workflow_async_enabled: z.boolean().optional(),
      requires_approval: z.boolean().optional(),
      policy: z.record(z.unknown()).optional(),
      trigger_rules: z.array(z.record(z.unknown())).optional(),
    },
  }, async (args) => {
    const body: Record<string, unknown> = {
      name: args.name,
      description: args.description ?? "",
      enabled: args.enabled ?? true,
      workflow_async_enabled: args.workflow_async_enabled ?? true,
      requires_approval: args.requires_approval ?? false,
      workflow_graph: args.workflow_graph,
    };
    if (args.policy) body.policy = args.policy;
    if (args.trigger_rules) body.trigger_rules = args.trigger_rules;
    try {
      const path = `/api/ambient/agents/${encodeURIComponent(args.ambient_agent_id)}/workflows`;
      return ok(`Created ambient workflow ${args.name}.`, {
        workflow: await ctx.api.agentJSON("POST", path, body),
      });
    } catch (e) { return fail(String(e)); }
  });

  server.registerTool("yaaif_ambient_workflow_get", {
    description: "Get an ambient workflow by id.",
    inputSchema: { workflow_id: z.string() },
  }, async ({ workflow_id }) => {
    try {
      return ok("Fetched ambient workflow.", {
        workflow: await ctx.api.agentJSON("GET", `/api/ambient/workflows/${encodeURIComponent(workflow_id)}`),
      });
    } catch (e) { return fail(String(e)); }
  });

  server.registerTool("yaaif_ambient_workflow_list", {
    description: "List ambient workflows.",
    inputSchema: { ambient_agent_id: z.string().optional(), q: z.string().optional() },
  }, async ({ ambient_agent_id, q }) => {
    const params = new URLSearchParams();
    if (ambient_agent_id) params.set("ambient_agent_id", ambient_agent_id);
    if (q) params.set("q", q);
    const path = `/api/ambient/workflows${params.size ? `?${params}` : ""}`;
    try {
      return ok("Listed ambient workflows.", { result: await ctx.api.agentJSON("GET", path) });
    } catch (e) { return fail(String(e)); }
  });

  server.registerTool("yaaif_ambient_workflow_update", {
    description: "Update an ambient workflow graph / metadata.",
    inputSchema: {
      workflow_id: z.string(),
      name: z.string().optional(),
      description: z.string().optional(),
      enabled: z.boolean().optional(),
      workflow_async_enabled: z.boolean().optional(),
      requires_approval: z.boolean().optional(),
      policy: z.record(z.unknown()).optional(),
      workflow_graph: z.record(z.unknown()).optional(),
      trigger_rules: z.array(z.record(z.unknown())).optional(),
      expected_updated_at: z.string().optional(),
    },
  }, async (args) => {
    const { workflow_id, ...rest } = args;
    const body: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(rest)) {
      if (v !== undefined) body[k] = v;
    }
    try {
      return ok("Updated ambient workflow.", {
        workflow: await ctx.api.agentJSON("PUT", `/api/ambient/workflows/${encodeURIComponent(workflow_id)}`, body),
      });
    } catch (e) { return fail(String(e)); }
  });

  server.registerTool("yaaif_ambient_test_trigger", {
    description: "Fire a test signal against an ambient workflow.",
    inputSchema: {
      workflow_id: z.string(),
      event_type: z.string(),
      entity_type: z.string(),
      entity_id: z.string(),
      source: z.string().optional(),
      payload: z.record(z.unknown()).optional(),
    },
  }, async (args) => {
    try {
      const path = `/api/ambient/workflows/${encodeURIComponent(args.workflow_id)}/test-trigger`;
      const result = await ctx.api.agentJSON("POST", path, {
        source: args.source || "manual",
        event_type: args.event_type,
        entity_type: args.entity_type,
        entity_id: args.entity_id,
        payload: args.payload ?? {},
      });
      return ok("Triggered ambient workflow test.", { result });
    } catch (e) { return fail(String(e)); }
  });

  server.registerTool("yaaif_ambient_runs_list", {
    description: "List ambient workflow runs.",
    inputSchema: {
      ambient_agent_id: z.string().optional(),
      workflow_id: z.string().optional(),
      limit: z.number().optional(),
    },
  }, async (args) => {
    const params = new URLSearchParams();
    if (args.ambient_agent_id) params.set("ambient_agent_id", args.ambient_agent_id);
    if (args.workflow_id) params.set("workflow_id", args.workflow_id);
    if (args.limit) params.set("limit", String(args.limit));
    const path = `/api/ambient/runs${params.size ? `?${params}` : ""}`;
    try {
      return ok("Listed ambient runs.", { result: await ctx.api.agentJSON("GET", path) });
    } catch (e) { return fail(String(e)); }
  });

  server.registerTool("yaaif_ambient_run_get", {
    description: "Get one ambient run by id.",
    inputSchema: { run_id: z.string() },
  }, async ({ run_id }) => {
    try {
      return ok("Fetched ambient run.", {
        run: await ctx.api.agentJSON("GET", `/api/ambient/runs/${encodeURIComponent(run_id)}`),
      });
    } catch (e) { return fail(String(e)); }
  });
}

function registerMcp(server: McpServer, ctx: Ctx): void {
  server.registerTool("yaaif_mcp_scaffold", {
    description: "Scaffold a new MCP server from official YAAIF templates into the workspace.",
    inputSchema: {
      name: z.string(),
      language: z.enum(["go", "python"]).optional(),
      target_dir: z.string().optional(),
      workspace_root: z.string().optional(),
    },
  }, async (args) => {
    try {
      let name = args.name.replace(/-mcp-service$/, "");
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) {
        return fail(`name must be kebab-case: ${name}`);
      }
      const lang = args.language || "go";
      const workspace = args.workspace_root || process.cwd();
      const parent = args.target_dir
        ? (args.target_dir.startsWith("/") ? args.target_dir : join(workspace, args.target_dir))
        : join(workspace, "mcp-servers");
      const dest = join(parent, `${name}-mcp-service`);
      if (existsSync(dest)) return fail(`destination already exists: ${dest}`);
      const repo = lang === "python"
        ? "https://github.com/yaaif/mcp-server-templates-py.git"
        : "https://github.com/yaaif/mcp-server-templates-go.git";
      const tmp = mkdtempSync(join(tmpdir(), "yaaif-mcp-scaffold-"));
      try {
        execFileSync("git", ["clone", "--depth", "1", repo, tmp], { stdio: "inherit" });
        cpSync(tmp, dest, {
          recursive: true,
          filter: (src) => !src.includes(`${join(tmp, ".git")}`) && !src.endsWith("/.git"),
        });
        rmSync(join(dest, ".git"), { recursive: true, force: true });
        const renameScript = join(dest, "scripts", "rename-service.sh");
        if (existsSync(renameScript)) {
          try { execFileSync("bash", [renameScript, name], { cwd: dest, stdio: "inherit" }); } catch { /* best-effort */ }
        }
      } finally {
        rmSync(tmp, { recursive: true, force: true });
      }
      return ok(`Scaffolded MCP service at ${dest}.`, {
        path: dest,
        name: `${name}-mcp-service`,
        language: lang,
        template: repo,
        next_steps: [
          "Implement tools from contracts",
          "Build and push container image",
          "Call yaaif_mcp_deployment_create + deploy + register",
        ],
      });
    } catch (e) { return fail(String(e)); }
  });

  server.registerTool("yaaif_mcp_deployment_create", {
    description: "Create an MCP deployment record (api-server → deployment-service).",
    inputSchema: {
      name: z.string(),
      image: z.string(),
      deployment_method: z.enum(["docker_compose", "kubernetes_gitops"]).optional(),
      container_port: z.number().optional(),
      mcp_path: z.string().optional(),
      endpoint_mode: z.string().optional(),
      endpoint_host: z.string().optional(),
      transport_type: z.string().optional(),
      env: z.record(z.string()).optional(),
      auto_register: z.boolean().optional(),
      auto_import_tools: z.boolean().optional(),
      registry_credential_id: z.string().optional(),
    },
  }, async (args) => {
    const body: Record<string, unknown> = {
      name: args.name,
      image: args.image,
      deployment_method: args.deployment_method || "docker_compose",
      container_port: args.container_port ?? 8080,
      mcp_path: args.mcp_path || "/mcp",
      endpoint_mode: args.endpoint_mode || "docker_name",
      transport_type: args.transport_type || "HTTP",
      env: args.env ?? {},
      secret_env: [],
      client_secret_headers: [],
      auto_register: args.auto_register ?? true,
      auto_import_tools: args.auto_import_tools ?? true,
    };
    if (args.endpoint_host) body.endpoint_host = args.endpoint_host;
    if (args.registry_credential_id) body.registry_credential_id = args.registry_credential_id;
    try {
      return ok(`Created MCP deployment ${args.name}.`, {
        deployment: await ctx.api.apiJSON("POST", "/api/mcp-deployments", body),
      });
    } catch (e) { return fail(String(e)); }
  });

  server.registerTool("yaaif_mcp_deployment_deploy", {
    description: "Deploy an MCP deployment by id.",
    inputSchema: { deployment_id: z.string() },
  }, async ({ deployment_id }) => {
    try {
      return ok("Deploy started/updated.", {
        deployment: await ctx.api.apiJSON("POST", `/api/mcp-deployments/${encodeURIComponent(deployment_id)}/deploy`, {}),
      });
    } catch (e) { return fail(String(e)); }
  });

  server.registerTool("yaaif_mcp_deployment_register", {
    description: "Register a deployed MCP server into the agent-service tool catalog.",
    inputSchema: { deployment_id: z.string() },
  }, async ({ deployment_id }) => {
    try {
      return ok("Registered MCP deployment into catalog.", {
        deployment: await ctx.api.apiJSON("POST", `/api/mcp-deployments/${encodeURIComponent(deployment_id)}/register`, {}),
      });
    } catch (e) { return fail(String(e)); }
  });

  server.registerTool("yaaif_mcp_deployment_status", {
    description: "Get MCP deployment status by id.",
    inputSchema: { deployment_id: z.string() },
  }, async ({ deployment_id }) => {
    try {
      return ok("Fetched MCP deployment.", {
        deployment: await ctx.api.apiJSON("GET", `/api/mcp-deployments/${encodeURIComponent(deployment_id)}`),
      });
    } catch (e) { return fail(String(e)); }
  });

  server.registerTool("yaaif_mcp_deployment_logs", {
    description: "Fetch MCP deployment logs.",
    inputSchema: { deployment_id: z.string(), tail: z.number().optional() },
  }, async ({ deployment_id, tail }) => {
    const params = new URLSearchParams();
    if (tail) params.set("tail", String(tail));
    const path = `/api/mcp-deployments/${encodeURIComponent(deployment_id)}/logs${params.size ? `?${params}` : ""}`;
    try {
      return ok("Fetched MCP deployment logs.", { logs: await ctx.api.apiJSON("GET", path) });
    } catch (e) { return fail(String(e)); }
  });

  server.registerTool("yaaif_mcp_link_or_create", {
    description: "Idempotently link/create an external MCP tool in the tenant catalog.",
    inputSchema: {
      name: z.string(),
      endpoint: z.string(),
      description: z.string().optional(),
      transport_type: z.string().optional(),
      remote_tool_name: z.string().optional(),
      server_id: z.string().optional(),
      enabled: z.boolean().optional(),
      timeout_seconds: z.number().optional(),
      headers: z.record(z.unknown()).optional(),
      env: z.record(z.unknown()).optional(),
    },
  }, async (args) => {
    const body: Record<string, unknown> = {
      name: args.name,
      description: args.description ?? "",
      endpoint: args.endpoint,
      transport_type: args.transport_type || "HTTP",
      remote_tool_name: args.remote_tool_name || args.name,
      enabled: args.enabled ?? true,
      timeout_seconds: args.timeout_seconds ?? 60,
      command: "",
      command_args: [],
      env: args.env ?? {},
      headers: args.headers ?? {},
    };
    if (args.server_id) body.server_id = args.server_id;
    try {
      return ok(`Linked/created MCP tool ${args.name}.`, {
        result: await ctx.api.agentJSON("POST", "/api/mcp-tools/link-or-create", body),
      });
    } catch (e) { return fail(String(e)); }
  });

  server.registerTool("yaaif_mcp_server_refresh", {
    description: "Refresh tools from a registered external MCP server.",
    inputSchema: { server_id: z.string() },
  }, async ({ server_id }) => {
    try {
      return ok("Refreshed MCP server tools.", {
        result: await ctx.api.agentJSON("POST", `/api/mcp-tools/servers/${encodeURIComponent(server_id)}/refresh`, {}),
      });
    } catch (e) { return fail(String(e)); }
  });

  server.registerTool("yaaif_mcp_tools_list", {
    description: "List external MCP tools in the tenant catalog.",
    inputSchema: { q: z.string().optional() },
  }, async ({ q }) => {
    const path = q ? `/api/mcp-tools?q=${encodeURIComponent(q)}` : "/api/mcp-tools";
    try {
      return ok("Listed MCP tools.", { result: await ctx.api.agentJSON("GET", path) });
    } catch (e) { return fail(String(e)); }
  });
}
