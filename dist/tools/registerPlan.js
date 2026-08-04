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
        load("local_tools", () => ctx.api.agentJSON("GET", "/api/local-tools?names_only=true")),
    ]);
    if (Object.keys(errors).length)
        out.errors = errors;
    return out;
}
export function registerPlanTools(server, ctx) {
    server.registerTool("yaaif_plan_verify", {
        description: "Diff expected plan components (agent/skill/workflow/MCP/local-tool names) against the live tenant catalog.",
        inputSchema: {
            agent_names: z.array(z.string()).optional(),
            skill_ids: z.array(z.string()).optional(),
            workflow_names: z.array(z.string()).optional(),
            mcp_tool_names: z.array(z.string()).optional(),
            ambient_agent_names: z.array(z.string()).optional(),
            local_tool_names: z.array(z.string()).optional(),
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
                local_tool_names: args.local_tool_names,
            }, buckets);
            void ctx.telemetry.increment(result.ok ? "plan_verify_ok" : "plan_verify_fail");
            return ok(result.ok ? "Plan verification passed." : "Plan verification found missing components.", { ...result, catalog_errors: raw.errors });
        }
        catch (e) {
            void ctx.telemetry.increment("plan_verify_fail");
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
                local_tool_names: z.array(z.string()).optional(),
            }).optional(),
        },
    }, async ({ actions, verify_catalog, expected }) => {
        const mutating = actions.filter((a) => !/^yaaif_(catalog_|.*_list|.*_get|whoami|configure|skill_tools_check|local_tools)/.test(a.tool));
        const out = {
            dry_run: true,
            action_count: actions.length,
            mutating_action_count: mutating.length,
            actions,
            note: "No APIs were called except optional catalog verify (includes local tools).",
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
                    local_tools: buckets.local_tools.length,
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
    server.registerTool("yaaif_plan_execution_save", {
        description: "Persist a plan execution checklist (step statuses + result ids) under ~/.yaaif/cursor/plan-executions/ for resume.",
        inputSchema: {
            slug: z.string(),
            plan_path: z.string().optional(),
            steps: z.array(z.object({
                id: z.string(),
                tool: z.string(),
                arguments: z.record(z.unknown()).optional(),
                note: z.string().optional(),
                status: z.enum(["pending", "done", "failed", "skipped"]).optional(),
                result_ids: z.record(z.string()).optional(),
                error: z.string().optional(),
            })),
        },
    }, async ({ slug, plan_path, steps }) => {
        const sess = await ctx.auth.session();
        const now = new Date().toISOString();
        const existing = await ctx.plans.get(slug);
        const normalized = steps.map((s) => ({
            id: s.id,
            tool: s.tool,
            arguments: s.arguments,
            note: s.note,
            status: s.status || "pending",
            result_ids: s.result_ids,
            error: s.error,
            updated_at: now,
        }));
        const exec = {
            slug,
            plan_path: plan_path || existing?.plan_path,
            tenant_id: sess?.tenant_id,
            profile_id: ctx.cfg.activeProfileId || sess?.profile_id,
            created_at: existing?.created_at || now,
            updated_at: now,
            steps: normalized,
        };
        const saved = await ctx.plans.save(exec);
        return ok(`Saved plan execution ${slug}.`, { execution: saved, resume: ctx.plans.resumeHint(saved) });
    });
    server.registerTool("yaaif_plan_execution_get", {
        description: "Load a saved plan execution by slug.",
        inputSchema: { slug: z.string() },
    }, async ({ slug }) => {
        const exec = await ctx.plans.get(slug);
        if (!exec)
            return fail(`plan execution not found: ${slug}`);
        return ok(`Loaded plan execution ${slug}.`, { execution: exec, resume: ctx.plans.resumeHint(exec) });
    });
    server.registerTool("yaaif_plan_execution_list", {
        description: "List saved plan executions.",
        inputSchema: {},
    }, async () => {
        return ok("Listed plan executions.", { items: await ctx.plans.list() });
    });
    server.registerTool("yaaif_plan_execution_update_step", {
        description: "Update one step status/result_ids on a saved plan execution (call after each mutate).",
        inputSchema: {
            slug: z.string(),
            step_id: z.string(),
            status: z.enum(["pending", "done", "failed", "skipped"]),
            result_ids: z.record(z.string()).optional(),
            error: z.string().optional(),
        },
    }, async ({ slug, step_id, status, result_ids, error }) => {
        const exec = await ctx.plans.get(slug);
        if (!exec)
            return fail(`plan execution not found: ${slug}`);
        const step = exec.steps.find((s) => s.id === step_id);
        if (!step)
            return fail(`step not found: ${step_id}`);
        step.status = status;
        step.result_ids = result_ids ?? step.result_ids;
        step.error = error;
        step.updated_at = new Date().toISOString();
        const saved = await ctx.plans.save(exec);
        return ok(`Updated step ${step_id} → ${status}.`, { execution: saved, resume: ctx.plans.resumeHint(saved) });
    });
    server.registerTool("yaaif_plan_execution_resume", {
        description: "Return the next pending/failed step and collected ids so the agent can continue without redoing completed work.",
        inputSchema: { slug: z.string() },
    }, async ({ slug }) => {
        const exec = await ctx.plans.get(slug);
        if (!exec)
            return fail(`plan execution not found: ${slug}`);
        const resume = ctx.plans.resumeHint(exec);
        return ok(resume.complete
            ? `Plan execution ${slug} is complete.`
            : `Resume ${slug} at step ${resume.next_step?.id} (${resume.next_step?.tool}).`, { execution: exec, resume });
    });
}
