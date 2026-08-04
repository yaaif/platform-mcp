import { z } from "zod";
import { fail, ok } from "./helpers.js";
import { extractCatalogBuckets, verifyPlanAgainstCatalog } from "../lib/planCatalog.js";
async function loadCatalogSnapshot(ctx, q, limit) {
    const lim = limit && limit > 0 ? limit : 100;
    const params = new URLSearchParams({ limit: String(lim) });
    if (q)
        params.set("q", q);
    const qs = `?${params}`;
    const out = {};
    const errors = {};
    const load = async (key, fn) => {
        try {
            out[key] = await fn();
        }
        catch (e) {
            errors[key] = String(e);
        }
    };
    await Promise.all([
        load("agents", () => ctx.api.agentJSON("GET", `/api/agents${qs}`)),
        load("skills", () => ctx.api.agentJSON("GET", `/api/skills${qs}`)),
        load("mcp_tools", () => ctx.api.agentJSON("GET", `/api/mcp-tools${qs}`)),
        load("ambient_agents", () => ctx.api.agentJSON("GET", `/api/ambient/agents${qs}`)),
        load("ambient_workflows", () => ctx.api.agentJSON("GET", `/api/ambient/workflows${qs}`)),
    ]);
    if (Object.keys(errors).length)
        out.errors = errors;
    return out;
}
export function registerPlanTools(server, ctx) {
    server.registerTool("yaaif_plan_verify", {
        description: "Diff expected plan components (agent/skill/workflow/MCP names) against the live tenant catalog.",
        inputSchema: {
            agent_names: z.array(z.string()).optional(),
            skill_ids: z.array(z.string()).optional(),
            workflow_names: z.array(z.string()).optional(),
            mcp_tool_names: z.array(z.string()).optional(),
            ambient_agent_names: z.array(z.string()).optional(),
            q: z.string().optional(),
            limit: z.number().optional(),
        },
    }, async (args) => {
        try {
            const raw = await loadCatalogSnapshot(ctx, args.q, args.limit);
            const buckets = extractCatalogBuckets(raw);
            const result = verifyPlanAgainstCatalog({
                agent_names: args.agent_names,
                skill_ids: args.skill_ids,
                workflow_names: args.workflow_names,
                mcp_tool_names: args.mcp_tool_names,
                ambient_agent_names: args.ambient_agent_names,
            }, buckets);
            return ok(result.ok ? "Plan verification passed." : "Plan verification found missing components.", { ...result, catalog_errors: raw.errors });
        }
        catch (e) {
            return fail(String(e));
        }
    });
    server.registerTool("yaaif_plan_dry_run", {
        description: "Dry-run an execution plan: echo intended tool calls without mutating the tenant. Optionally check catalog refs.",
        inputSchema: {
            actions: z.array(z.object({
                tool: z.string(),
                arguments: z.record(z.unknown()).optional(),
                note: z.string().optional(),
            })),
            verify_catalog: z.boolean().optional(),
            expected: z.object({
                agent_names: z.array(z.string()).optional(),
                skill_ids: z.array(z.string()).optional(),
                workflow_names: z.array(z.string()).optional(),
                mcp_tool_names: z.array(z.string()).optional(),
                ambient_agent_names: z.array(z.string()).optional(),
            }).optional(),
        },
    }, async ({ actions, verify_catalog, expected }) => {
        const mutating = actions.filter((a) => !/^yaaif_(catalog_|.*_list|.*_get|whoami|configure)/.test(a.tool));
        const out = {
            dry_run: true,
            action_count: actions.length,
            mutating_action_count: mutating.length,
            actions,
            note: "No APIs were called except optional catalog verify.",
        };
        if (verify_catalog || expected) {
            try {
                const raw = await loadCatalogSnapshot(ctx);
                const buckets = extractCatalogBuckets(raw);
                out.catalog_snapshot_summary = {
                    agents: buckets.agents.length,
                    skills: buckets.skills.length,
                    workflows: buckets.workflows.length,
                    mcp_tools: buckets.mcp_tools.length,
                    ambient_agents: buckets.ambient_agents.length,
                };
                if (expected) {
                    out.precheck = verifyPlanAgainstCatalog(expected, buckets);
                }
            }
            catch (e) {
                out.catalog_verify_error = String(e);
            }
        }
        return ok(`Dry-run prepared ${actions.length} action(s); nothing was mutated.`, out);
    });
}
