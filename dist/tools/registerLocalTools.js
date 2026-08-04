import { z } from "zod";
import { fail, ok } from "./helpers.js";
const MUTATING_ACK_TOOLS = new Set([
    "skill_archive_or_delete",
    "skill_repo_ops",
    "skill_release_manager",
    "ambient_approval_delete",
    "session_state_delete",
]);
async function persistDevSession(ctx, result) {
    await ctx.auth.patchSession({
        dev_session_id: result.session_id,
        dev_agent_id: result.agent_id,
    });
}
async function resolveDevSessionId(ctx, explicit) {
    if (explicit?.trim())
        return explicit.trim();
    const sess = await ctx.auth.session();
    return sess?.dev_session_id?.trim() || undefined;
}
export function registerLocalTools(server, ctx) {
    server.registerTool("yaaif_local_tools_list", {
        description: "List agent-service built-in local tools (skill lifecycle, files, ambient trigger, state, approvals). Use when authoring SKILL.md tools: lists.",
        inputSchema: {
            family: z
                .enum(["skill", "files", "ambient", "approval", "state", "memory", "context_store", "client", "other"])
                .optional(),
            q: z.string().optional(),
        },
    }, async ({ family, q }) => {
        const params = new URLSearchParams();
        if (family)
            params.set("family", family);
        if (q)
            params.set("q", q);
        const path = `/api/local-tools${params.size ? `?${params}` : ""}`;
        try {
            const result = await ctx.api.agentJSON("GET", path);
            return ok(`Listed ${result.count ?? 0} local tools.`, { result });
        }
        catch (e) {
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
        }
        catch (e) {
            return fail(String(e));
        }
    });
    server.registerTool("yaaif_local_tools_catalog_overview", {
        description: "Counts of local tools by family plus recommended skill-authoring tools.",
        inputSchema: {},
    }, async () => {
        try {
            const result = await ctx.api.agentJSON("GET", "/api/local-tools");
            const items = Array.isArray(result.items) ? result.items : [];
            const recommended = items.filter((i) => i.recommended_for_skill_authoring === true).map((i) => i.name);
            return ok("Local tools catalog overview.", {
                total: result.total ?? items.length,
                family_counts: result.family_counts ?? {},
                recommended_for_skill_authoring: recommended,
            });
        }
        catch (e) {
            return fail(String(e));
        }
    });
    server.registerTool("yaaif_local_tool_call", {
        description: "Invoke an agent-service built-in local tool (not external MCP). Prefer for skill_validate_module, skill_develop, files_list, list_ambient_workflows, etc. High-impact tools require allow_mutating=true.",
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
        if (!toolName)
            return fail("name is required");
        const needsAck = MUTATING_ACK_TOOLS.has(toolName.toLowerCase());
        if (needsAck && !allow_mutating) {
            return fail(`tool requires allow_mutating=true: ${toolName}`);
        }
        const sessionId = await resolveDevSessionId(ctx, session_id);
        try {
            const result = await ctx.api.agentJSON("POST", `/api/local-tools/${encodeURIComponent(toolName)}/call`, {
                arguments: args ?? {},
                session_id: sessionId,
                agent_id: agent_id,
                branch,
                allow_mutating: Boolean(allow_mutating),
                resolve_workspace: resolve_workspace,
            });
            const isError = Boolean(result?.is_error);
            if (isError) {
                return fail(`Local tool ${toolName} returned an error.`, { result });
            }
            return ok(`Called local tool ${toolName}.`, { result });
        }
        catch (e) {
            return fail(String(e));
        }
    });
    server.registerTool("yaaif_dev_session_ensure", {
        description: "Create or reuse a Cursor authoring chat session for files_* / session_state_* local tools. Persists session_id in ~/.yaaif/cursor/session.json.",
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
            const result = await ctx.api.agentJSON("POST", "/api/local-tools/dev-session", {
                session_id: session_id || undefined,
                agent_id: agent_id || undefined,
            });
            await persistDevSession(ctx, result);
            return ok("Created Cursor dev session.", { ...result, reused: false });
        }
        catch (e) {
            return fail(String(e));
        }
    });
    // Convenience aliases for common skill-authoring locals
    const alias = (tool, localName, description, extraSchema = {}) => {
        server.registerTool(tool, {
            description,
            inputSchema: {
                arguments: z.record(z.unknown()).optional(),
                session_id: z.string().optional(),
                agent_id: z.string().optional(),
                ...extraSchema,
            },
        }, async (input) => {
            const sessionId = await resolveDevSessionId(ctx, input.session_id);
            try {
                const result = await ctx.api.agentJSON("POST", `/api/local-tools/${encodeURIComponent(localName)}/call`, {
                    arguments: input.arguments ?? {},
                    session_id: sessionId,
                    agent_id: input.agent_id,
                    resolve_workspace: true,
                });
                const isError = Boolean(result?.is_error);
                if (isError)
                    return fail(`Local tool ${localName} returned an error.`, { result });
                return ok(`Called ${localName}.`, { result });
            }
            catch (e) {
                return fail(String(e));
            }
        });
    };
    alias("yaaif_skill_validate_module", "skill_validate_module", "Validate a skill module via platform local tool skill_validate_module (prefer over weak REST validate).");
    alias("yaaif_skill_develop", "skill_develop", "Run platform skill_develop local tool (guided skill edits).");
    alias("yaaif_skill_guided_draft", "skill_create_guided_draft", "Create a guided skill draft via platform local tool skill_create_guided_draft.");
    alias("yaaif_skill_mcp_tool_catalog", "skill_mcp_tool_catalog", "List MCP tool catalog entries available for skill tool linking (platform local tool).");
    alias("yaaif_files_list", "files_list", "List ingested files for the Cursor/dev session (platform local tool files_list). Call yaaif_dev_session_ensure first.");
    alias("yaaif_file_load_context", "file_load_context", "Load extracted file text via platform local tool file_load_context.");
}
