import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Ctx } from "./ctx.js";
import { fail, ok } from "./helpers.js";
import {
  extractSkillToolsFromMarkdown,
  verifyToolsAgainstCatalogs,
} from "../lib/skillFrontmatter.js";

const MUTATING_ACK_TOOLS = new Set([
  "skill_archive_or_delete",
  "skill_repo_ops",
  "skill_release_manager",
  "ambient_approval_delete",
  "session_state_delete",
]);

type LocalToolsListResponse = {
  count?: number;
  total?: number;
  family_counts?: Record<string, number>;
  items?: Array<Record<string, unknown>>;
  names?: string[];
};

type DevSessionResponse = {
  session_id?: string;
  agent_id?: string;
  tenant_id?: string;
  user_id?: string;
  session_channel?: string;
  agent_resolved?: boolean;
};

async function persistDevSession(ctx: Ctx, result: DevSessionResponse): Promise<void> {
  await ctx.auth.patchSession({
    dev_session_id: result.session_id,
    dev_agent_id: result.agent_id,
  });
}

async function resolveDevSessionId(ctx: Ctx, explicit?: string): Promise<string | undefined> {
  if (explicit?.trim()) return explicit.trim();
  const sess = await ctx.auth.session();
  return sess?.dev_session_id?.trim() || undefined;
}

async function resolveDevAgentId(ctx: Ctx, explicit?: string): Promise<string | undefined> {
  if (explicit?.trim()) return explicit.trim();
  const sess = await ctx.auth.session();
  return sess?.dev_agent_id?.trim() || undefined;
}

async function callLocal(
  ctx: Ctx,
  localName: string,
  args: Record<string, unknown> | undefined,
  opts: {
    session_id?: string;
    agent_id?: string;
    branch?: string;
    allow_mutating?: boolean;
    resolve_workspace?: boolean;
  } = {},
) {
  const sessionId = await resolveDevSessionId(ctx, opts.session_id);
  const agentId = await resolveDevAgentId(ctx, opts.agent_id);
  return ctx.api.agentJSON("POST", `/api/local-tools/${encodeURIComponent(localName)}/call`, {
    arguments: args ?? {},
    session_id: sessionId,
    agent_id: agentId,
    branch: opts.branch,
    allow_mutating: Boolean(opts.allow_mutating),
    resolve_workspace: opts.resolve_workspace,
  });
}

export function registerLocalTools(server: McpServer, ctx: Ctx): void {
  server.registerTool("yaaif_local_tools_list", {
    description:
      "List agent-service built-in local tools (skill lifecycle, files, ambient trigger, state, approvals). Use when authoring SKILL.md tools: lists.",
    inputSchema: {
      family: z
        .enum(["skill", "files", "ambient", "approval", "state", "memory", "context_store", "client", "other"])
        .optional(),
      q: z.string().optional(),
      limit: z.number().optional(),
      offset: z.number().optional(),
      names_only: z.boolean().optional(),
    },
  }, async ({ family, q, limit, offset, names_only }) => {
    const params = new URLSearchParams();
    if (family) params.set("family", family);
    if (q) params.set("q", q);
    if (limit && limit > 0) params.set("limit", String(limit));
    if (offset && offset >= 0) params.set("offset", String(offset));
    if (names_only) params.set("names_only", "true");
    const path = `/api/local-tools${params.size ? `?${params}` : ""}`;
    try {
      const result = await ctx.api.agentJSON<LocalToolsListResponse>("GET", path);
      return ok(`Listed ${result.count ?? 0} local tools.`, { result });
    } catch (e) {
      return fail(String(e));
    }
  });

  server.registerTool("yaaif_local_tool_get", {
    description: "Get one local tool definition (name, description, input_schema, family).",
    inputSchema: { name: z.string() },
  }, async ({ name }) => {
    try {
      const tool = await ctx.api.agentJSON("GET", `/api/local-tools/${encodeURIComponent(name)}`);
      return ok(`Fetched local tool ${name}.`, { tool });
    } catch (e) {
      return fail(String(e));
    }
  });

  server.registerTool("yaaif_local_tools_catalog_overview", {
    description: "Counts of local tools by family plus recommended skill-authoring tools.",
    inputSchema: {},
  }, async () => {
    try {
      const result = await ctx.api.agentJSON<LocalToolsListResponse>("GET", "/api/local-tools");
      const items = Array.isArray(result.items) ? result.items : [];
      const recommended = items.filter((i) => i.recommended_for_skill_authoring === true).map((i) => i.name);
      return ok("Local tools catalog overview.", {
        total: result.total ?? items.length,
        family_counts: result.family_counts ?? {},
        recommended_for_skill_authoring: recommended,
      });
    } catch (e) {
      return fail(String(e));
    }
  });

  server.registerTool("yaaif_local_tool_call", {
    description:
      "Invoke an agent-service built-in local tool (not external MCP). Prefer for skill_validate_module, skill_develop, files_list, list_ambient_workflows, etc. High-impact tools require allow_mutating=true.",
    inputSchema: {
      name: z.string(),
      arguments: z.record(z.unknown()).optional(),
      session_id: z.string().optional(),
      agent_id: z.string().optional(),
      branch: z.string().optional(),
      allow_mutating: z.boolean().optional(),
      resolve_workspace: z.boolean().optional(),
    },
  }, async ({ name, arguments: args, session_id, agent_id, branch, allow_mutating, resolve_workspace }) => {
    const toolName = name.trim();
    if (!toolName) return fail("name is required");
    if (MUTATING_ACK_TOOLS.has(toolName.toLowerCase()) && !allow_mutating) {
      return fail(`tool requires allow_mutating=true: ${toolName}`);
    }
    try {
      const result = await callLocal(ctx, toolName, args as Record<string, unknown> | undefined, {
        session_id,
        agent_id,
        branch,
        allow_mutating,
        resolve_workspace,
      });
      if ((result as { is_error?: boolean })?.is_error) {
        return fail(`Local tool ${toolName} returned an error.`, { result });
      }
      return ok(`Called local tool ${toolName}.`, { result });
    } catch (e) {
      return fail(String(e));
    }
  });

  server.registerTool("yaaif_dev_session_ensure", {
    description:
      "Create or reuse a Cursor authoring chat session for files_* / session_state_* local tools. Auto-picks default skills agent when agent_id omitted. Persists ids in ~/.yaaif/cursor/session.json.",
    inputSchema: {
      session_id: z.string().optional(),
      agent_id: z.string().optional(),
      force_new: z.boolean().optional(),
    },
  }, async ({ session_id, agent_id, force_new }) => {
    try {
      if (!force_new) {
        const existing = await resolveDevSessionId(ctx, session_id);
        if (existing) {
          const sess = await ctx.auth.session();
          return ok("Reusing Cursor dev session.", {
            session_id: existing,
            agent_id: agent_id || sess?.dev_agent_id || "",
            reused: true,
          });
        }
      }
      const result = await ctx.api.agentJSON<DevSessionResponse>("POST", "/api/local-tools/dev-session", {
        session_id: session_id || undefined,
        agent_id: agent_id || undefined,
      });
      await persistDevSession(ctx, result);
      return ok("Created Cursor dev session.", { ...result, reused: false });
    } catch (e) {
      return fail(String(e));
    }
  });

  server.registerTool("yaaif_skill_tools_check", {
    description:
      "Verify skill frontmatter tools / allowed-tools (or an explicit tools list) exist in local tools or external MCP catalog. Run before skill create.",
    inputSchema: {
      markdown: z.string().optional(),
      tools: z.array(z.string()).optional(),
    },
  }, async ({ markdown, tools }) => {
    try {
      let list = (tools ?? []).map((t) => t.trim()).filter(Boolean);
      if (!list.length && markdown) {
        list = extractSkillToolsFromMarkdown(markdown);
      }
      if (!list.length) {
        return fail("No tools found — pass markdown with frontmatter or tools[].");
      }
      const [localRes, mcpRes] = await Promise.all([
        ctx.api.agentJSON<LocalToolsListResponse>("GET", "/api/local-tools?names_only=true"),
        ctx.api.agentJSON<{ items?: Array<{ name?: string }> }>("GET", "/api/mcp-tools?limit=500"),
      ]);
      const localNames = Array.isArray(localRes.names)
        ? localRes.names
        : (localRes.items ?? []).map((i) => String(i.name ?? "")).filter(Boolean);
      const mcpNames = (mcpRes.items ?? []).map((i) => String(i.name ?? "").trim()).filter(Boolean);
      const result = verifyToolsAgainstCatalogs(list, localNames, mcpNames);
      void ctx.telemetry.increment(result.ok ? "skill_tools_check_ok" : "skill_tools_check_fail");
      return result.ok
        ? ok("All skill tools exist in local or MCP catalogs.", result)
        : fail(`Missing tools: ${result.missing.join(", ")}`, result);
    } catch (e) {
      void ctx.telemetry.increment("skill_tools_check_fail");
      return fail(String(e));
    }
  });

  const alias = (tool: string, localName: string, description: string) => {
    server.registerTool(tool, {
      description,
      inputSchema: {
        arguments: z.record(z.unknown()).optional(),
        session_id: z.string().optional(),
        agent_id: z.string().optional(),
      },
    }, async (input) => {
      try {
        const result = await callLocal(
          ctx,
          localName,
          (input.arguments as Record<string, unknown> | undefined) ?? {},
          {
            session_id: input.session_id as string | undefined,
            agent_id: input.agent_id as string | undefined,
            resolve_workspace: true,
          },
        );
        if ((result as { is_error?: boolean })?.is_error) {
          return fail(`Local tool ${localName} returned an error.`, { result });
        }
        return ok(`Called ${localName}.`, { result });
      } catch (e) {
        return fail(String(e));
      }
    });
  };

  alias("yaaif_skill_validate_module", "skill_validate_module", "Validate a skill module via platform local tool skill_validate_module.");
  alias("yaaif_skill_develop", "skill_develop", "Run platform skill_develop local tool.");
  alias("yaaif_skill_guided_draft", "skill_create_guided_draft", "Create a guided skill draft via skill_create_guided_draft.");
  alias("yaaif_skill_mcp_tool_catalog", "skill_mcp_tool_catalog", "List MCP tools for skill linking (skill_mcp_tool_catalog).");
  alias("yaaif_skill_update_module_files", "skill_update_module_files", "Create/update/delete skill module files via skill_update_module_files.");
  alias("yaaif_skill_edit_section", "skill_edit_section", "Edit a SKILL.md section via skill_edit_section.");
  alias("yaaif_list_ambient_workflows", "list_ambient_workflows", "List ambient workflows via platform local tool.");
  alias("yaaif_trigger_ambient_workflow", "trigger_ambient_workflow", "Trigger an ambient workflow via platform local tool.");
  alias("yaaif_files_list", "files_list", "List ingested files for the Cursor/dev session. Call yaaif_dev_session_ensure first.");
  alias("yaaif_file_load_context", "file_load_context", "Load extracted file text via file_load_context.");
}
