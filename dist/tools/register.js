import { registerGovernanceTools } from "./registerGovernance.js";
import { registerWikiTools } from "./registerWiki.js";
import { registerPlatformUpdateTools } from "./registerPlatformUpdates.js";
import { registerMigrationTools } from "./registerMigration.js";
import { z } from "zod";
import { fail, ok } from "./helpers.js";
import { appendClampedLimit, clampCatalogLimit } from "../lib/catalogLimits.js";
import { mergeSkillIds } from "../lib/mergeSkillIds.js";
import { ENGINE_SPINE_ONLY_WARNING, isEngineSpineOnlyGraph } from "../lib/workflowGraph.js";
import { registerAuthTools } from "./registerAuth.js";
import { registerDesktopTools } from "./registerDesktop.js";
import { registerDesktopPackageTools } from "./registerDesktopPackages.js";
import { registerApprovalTools } from "./registerApproval.js";
import { registerPlanTools } from "./registerPlan.js";
import { registerSpecTools } from "./registerSpecs.js";
import { registerOpsTools } from "./registerOps.js";
import { registerDoctorTools } from "./registerDoctor.js";
import { registerDocsTools } from "./registerDocs.js";
import { registerLocalTools } from "./registerLocalTools.js";
import { registerFileTools } from "./registerFiles.js";
import { registerFileWorkflowTools } from "./registerFileWorkflows.js";
import { registerOpsSupportTools } from "./registerOpsSupport.js";
import { registerApiKeyTools } from "./registerApiKeys.js";
import { registerMcpDeploymentTools } from "./registerMcpDeployments.js";
import { registerUserTools } from "./registerUsers.js";
import { registerCredentialTools } from "./registerCredentials.js";
import { cpSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
export function registerAllTools(server, ctx) {
    registerAuthTools(server, ctx);
    registerGovernanceTools(server, ctx);
    registerWikiTools(server, ctx);
    registerPlatformUpdateTools(server, ctx);
    registerMigrationTools(server, ctx);
    registerSkills(server, ctx);
    registerAmbient(server, ctx);
    registerMcp(server, ctx);
    registerMcpDeploymentTools(server, ctx);
    registerApiKeyTools(server, ctx);
    registerUserTools(server, ctx);
    registerCredentialTools(server, ctx);
    registerDesktopTools(server, ctx);
    registerDesktopPackageTools(server, ctx);
    registerApprovalTools(server, ctx);
    registerPlanTools(server, ctx);
    registerSpecTools(server, ctx);
    registerOpsTools(server, ctx);
    registerOpsSupportTools(server, ctx);
    registerLocalTools(server, ctx);
    registerFileTools(server, ctx);
    registerFileWorkflowTools(server, ctx);
    registerDoctorTools(server, ctx);
    registerDocsTools(server, ctx);
}
function registerSkills(server, ctx) {
    server.registerTool("yaaif_skill_list", {
        description: "List skills in the tenant catalog.",
        inputSchema: { q: z.string().optional(), limit: z.number().optional() },
    }, async ({ q, limit }) => {
        const params = new URLSearchParams();
        if (q)
            params.set("q", q);
        appendClampedLimit(params, limit);
        const path = `/api/skills${params.size ? `?${params}` : ""}`;
        try {
            return ok("Listed skills.", { result: await ctx.api.agentJSON("GET", path) });
        }
        catch (e) {
            return fail(String(e));
        }
    });
    server.registerTool("yaaif_skill_get", {
        description: "Get one skill by id (via catalog list ?ids=).",
        inputSchema: { skill_id: z.string() },
    }, async ({ skill_id }) => {
        try {
            const result = await ctx.api.agentJSON("GET", `/api/skills?ids=${encodeURIComponent(skill_id)}&limit=1`);
            const items = Array.isArray(result?.items) ? result.items : [];
            const skill = items[0];
            if (!skill)
                return fail(`skill not found: ${skill_id}`);
            return ok("Fetched skill.", { skill, result });
        }
        catch (e) {
            return fail(String(e));
        }
    });
    server.registerTool("yaaif_skill_runtime_status", {
        description: "Get in-memory skill runtime status for the tenant.",
        inputSchema: {},
    }, async () => {
        try {
            return ok("Fetched skill runtime status.", {
                result: await ctx.api.agentJSON("GET", "/api/skills/runtime-status"),
            });
        }
        catch (e) {
            return fail(String(e));
        }
    });
    server.registerTool("yaaif_skill_file_tree", {
        description: "List the tenant skill files tree (Advanced Skills workspace).",
        inputSchema: { path: z.string().optional() },
    }, async ({ path: treePath }) => {
        const params = new URLSearchParams();
        if (treePath)
            params.set("path", treePath);
        const path = `/api/skill-files/tree${params.size ? `?${params}` : ""}`;
        try {
            return ok("Fetched skill file tree.", { result: await ctx.api.agentJSON("GET", path) });
        }
        catch (e) {
            return fail(String(e));
        }
    });
    server.registerTool("yaaif_skill_read_file", {
        description: "Read a skill pack file from the tenant skills tree.",
        inputSchema: { path: z.string() },
    }, async ({ path: filePath }) => {
        try {
            const path = `/api/skill-files/content?path=${encodeURIComponent(filePath)}`;
            return ok(`Read skill file ${filePath}.`, {
                result: await ctx.api.agentJSON("GET", path),
            });
        }
        catch (e) {
            return fail(String(e));
        }
    });
    server.registerTool("yaaif_skill_create", {
        description: "Create a skill pack in YAA\\F (writes SKILL.md + skill_configs).",
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
            spec_id: z.string().optional(),
            slot_key: z.string().optional(),
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
            updated_by: args.updated_by || ctx.cfg.client.updatedBy,
            assigned_user_emails: args.assigned_user_emails ?? [],
            scaffold: {
                include_references: args.include_references ?? true,
                include_examples: args.include_examples ?? true,
            },
            spec_id: args.spec_id,
            slot_key: args.slot_key,
        };
        try {
            return ok(`Created skill ${args.id}.`, { skill: await ctx.api.agentJSON("POST", "/api/skills", body) });
        }
        catch (e) {
            return fail(String(e));
        }
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
        }
        catch (e) {
            return fail(String(e));
        }
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
                skill_id, enabled, updated_by: updated_by || ctx.cfg.client.updatedBy,
            });
            return ok(`Skill ${skill_id} enabled=${enabled}.`, { skill });
        }
        catch (e) {
            return fail(String(e));
        }
    });
    server.registerTool("yaaif_skill_map_agents", {
        description: "Replace agent→skill mappings (bulk). Prefer yaaif_skill_map_agents_merge to avoid wiping existing skills.",
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
        }
        catch (e) {
            return fail(String(e));
        }
    });
    server.registerTool("yaaif_skill_map_agents_merge", {
        description: "Merge skill_ids into agents (fetch current mappings, union, then bulk replace). Safe default for plan execution.",
        inputSchema: {
            assignments: z.array(z.object({
                agent_id: z.string(),
                skill_ids: z.array(z.string()),
            })),
        },
    }, async ({ assignments }) => {
        try {
            const merged = [];
            for (const a of assignments) {
                const agent = await ctx.api.agentJSON("GET", `/api/agents/${encodeURIComponent(a.agent_id)}`);
                const skill_ids = mergeSkillIds(agent?.skill_ids, a.skill_ids);
                merged.push({
                    agent_id: a.agent_id,
                    skill_ids,
                    previous_skill_ids: agent?.skill_ids ?? [],
                    added_skill_ids: a.skill_ids,
                });
            }
            const result = await ctx.api.agentJSON("POST", "/api/agents/skills/bulk", {
                assignments: merged.map(({ agent_id, skill_ids }) => ({ agent_id, skill_ids })),
            });
            return ok("Merged agent skill mappings.", { merged, result });
        }
        catch (e) {
            return fail(String(e));
        }
    });
    server.registerTool("yaaif_skill_validate", {
        description: "Validate one skill or the catalog.",
        inputSchema: { skill_id: z.string().optional(), strict: z.boolean().optional() },
    }, async ({ skill_id, strict }) => {
        try {
            const body = { strict: strict ?? false };
            if (skill_id)
                body.skill_id = skill_id;
            return ok("Validated skills.", { result: await ctx.api.agentJSON("POST", "/api/skills/validate", body) });
        }
        catch (e) {
            return fail(String(e));
        }
    });
    server.registerTool("yaaif_skill_refresh", {
        description: "Re-discover skill files into the catalog.",
        inputSchema: {},
    }, async () => {
        try {
            return ok("Refreshed skill catalog.", { result: await ctx.api.agentJSON("POST", "/api/skills/refresh", {}) });
        }
        catch (e) {
            return fail(String(e));
        }
    });
    server.registerTool("yaaif_skill_runtime_reload", {
        description: "Reload in-memory skill runtime for agents.",
        inputSchema: {},
    }, async () => {
        try {
            return ok("Reloaded skill runtime.", { result: await ctx.api.agentJSON("POST", "/api/skills/runtime-reload", {}) });
        }
        catch (e) {
            return fail(String(e));
        }
    });
}
function registerAmbient(server, ctx) {
    server.registerTool("yaaif_agent_list", {
        description: "List agent definitions in the tenant (chat and workflow).",
        inputSchema: {
            q: z.string().optional(),
            agent_type: z.string().optional(),
            limit: z.number().optional(),
        },
    }, async ({ q, agent_type, limit }) => {
        // Fetch a wider page then filter client-side — backend ignores agent_type today.
        const params = new URLSearchParams();
        if (q)
            params.set("q", q);
        params.set("limit", String(clampCatalogLimit(limit, 50)));
        const path = `/api/agents?${params}`;
        try {
            const result = await ctx.api.agentJSON("GET", path);
            const items = Array.isArray(result?.items) ? result.items : [];
            const want = (agent_type || "").trim().toLowerCase();
            const filtered = want
                ? items.filter((a) => String(a.agent_type ?? "").toLowerCase() === want)
                : items;
            const capped = limit && limit > 0 ? filtered.slice(0, limit) : filtered;
            return ok("Listed agents.", {
                result: { ...result, items: capped, filtered_by_agent_type: want || null, unfiltered_count: items.length },
            });
        }
        catch (e) {
            return fail(String(e));
        }
    });
    server.registerTool("yaaif_agent_get", {
        description: "Get one agent definition by id (includes skill_ids).",
        inputSchema: { agent_id: z.string() },
    }, async ({ agent_id }) => {
        try {
            return ok("Fetched agent.", {
                agent: await ctx.api.agentJSON("GET", `/api/agents/${encodeURIComponent(agent_id)}`),
            });
        }
        catch (e) {
            return fail(String(e));
        }
    });
    server.registerTool("yaaif_ambient_agent_list", {
        description: "List ambient agent configs in the tenant.",
        inputSchema: { q: z.string().optional(), limit: z.number().optional() },
    }, async ({ q, limit }) => {
        const params = new URLSearchParams();
        if (q)
            params.set("q", q);
        appendClampedLimit(params, limit);
        const path = `/api/ambient/agents${params.size ? `?${params}` : ""}`;
        try {
            return ok("Listed ambient agents.", { result: await ctx.api.agentJSON("GET", path) });
        }
        catch (e) {
            return fail(String(e));
        }
    });
    server.registerTool("yaaif_ambient_agent_get", {
        description: "Get one ambient agent config by id.",
        inputSchema: { ambient_agent_id: z.string() },
    }, async ({ ambient_agent_id }) => {
        try {
            return ok("Fetched ambient agent.", {
                ambient_agent: await ctx.api.agentJSON("GET", `/api/ambient/agents/${encodeURIComponent(ambient_agent_id)}`),
            });
        }
        catch (e) {
            return fail(String(e));
        }
    });
    server.registerTool("yaaif_agent_create", {
        description: "Create a chat or workflow agent definition.",
        inputSchema: {
            name: z.string(),
            description: z.string(),
            goal_prompt: z.string(),
            agent_type: z.string().optional(),
            skill_ids: z.array(z.string()).optional(),
            enabled: z.boolean().optional(),
            spec_id: z.string().optional(),
            slot_key: z.string().optional(),
        },
    }, async (args) => {
        const body = {
            name: args.name,
            description: args.description,
            goal_prompt: args.goal_prompt,
            skill_ids: args.skill_ids ?? [],
            enabled: args.enabled ?? true,
        };
        if (args.spec_id)
            body.spec_id = args.spec_id;
        if (args.slot_key)
            body.slot_key = args.slot_key;
        if (args.agent_type)
            body.agent_type = args.agent_type;
        try {
            return ok(`Created agent ${args.name}.`, { agent: await ctx.api.agentJSON("POST", "/api/agents", body) });
        }
        catch (e) {
            return fail(String(e));
        }
    });
    server.registerTool("yaaif_agent_update", {
        description: "Update an existing agent (PUT). agent_type is immutable — omit it. skill_ids replaces mappings if provided.",
        inputSchema: {
            agent_id: z.string(),
            name: z.string().optional(),
            description: z.string().optional(),
            goal_prompt: z.string().optional(),
            skill_ids: z.array(z.string()).optional(),
            enabled: z.boolean().optional(),
        },
    }, async (args) => {
        const body = {};
        if (args.name !== undefined)
            body.name = args.name;
        if (args.description !== undefined)
            body.description = args.description;
        if (args.goal_prompt !== undefined)
            body.goal_prompt = args.goal_prompt;
        if (args.skill_ids !== undefined)
            body.skill_ids = args.skill_ids;
        if (args.enabled !== undefined)
            body.enabled = args.enabled;
        if (Object.keys(body).length === 0)
            return fail("No fields to update");
        try {
            return ok(`Updated agent ${args.agent_id}.`, {
                agent: await ctx.api.agentJSON("PUT", `/api/agents/${encodeURIComponent(args.agent_id)}`, body),
            });
        }
        catch (e) {
            return fail(String(e));
        }
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
            spec_id: z.string().optional(),
            slot_key: z.string().optional(),
        },
    }, async (args) => {
        const body = {
            name: args.name,
            description: args.description ?? "",
            agent_id: args.agent_id,
            enabled: args.enabled ?? true,
            mode: args.mode || "active",
            workflow_async_enabled: args.workflow_async_enabled ?? true,
            requires_approval: args.requires_approval ?? false,
        };
        if (args.policy)
            body.policy = args.policy;
        if (args.spec_id)
            body.spec_id = args.spec_id;
        if (args.slot_key)
            body.slot_key = args.slot_key;
        try {
            return ok(`Created ambient agent ${args.name}.`, {
                ambient_agent: await ctx.api.agentJSON("POST", "/api/ambient/agents", body),
            });
        }
        catch (e) {
            return fail(String(e));
        }
    });
    server.registerTool("yaaif_ambient_workflow_create", {
        description: "Install an ambient workflow graph under an ambient agent. Omit workflow_graph to seed from the Agent Spec workflow_design segment when spec_id or a bound ambient agent is available.",
        inputSchema: {
            ambient_agent_id: z.string(),
            name: z.string(),
            workflow_graph: z.record(z.unknown()).optional(),
            description: z.string().optional(),
            enabled: z.boolean().optional(),
            workflow_async_enabled: z.boolean().optional(),
            requires_approval: z.boolean().optional(),
            policy: z.record(z.unknown()).optional(),
            trigger_rules: z.array(z.record(z.unknown())).optional(),
            spec_id: z.string().optional(),
            slot_key: z.string().optional(),
        },
    }, async (args) => {
        const body = {
            name: args.name,
            description: args.description ?? "",
            enabled: args.enabled ?? true,
            workflow_async_enabled: args.workflow_async_enabled ?? true,
            requires_approval: args.requires_approval ?? false,
        };
        if (args.workflow_graph)
            body.workflow_graph = args.workflow_graph;
        if (args.policy)
            body.policy = args.policy;
        if (args.trigger_rules)
            body.trigger_rules = args.trigger_rules;
        if (args.spec_id)
            body.spec_id = args.spec_id;
        if (args.slot_key)
            body.slot_key = args.slot_key;
        try {
            const path = `/api/ambient/agents/${encodeURIComponent(args.ambient_agent_id)}/workflows`;
            const workflow = await ctx.api.agentJSON("POST", path, body);
            const warnings = isEngineSpineOnlyGraph(args.workflow_graph)
                ? [ENGINE_SPINE_ONLY_WARNING]
                : undefined;
            const summary = warnings
                ? `Created ambient workflow ${args.name}. Warning: ${ENGINE_SPINE_ONLY_WARNING}`
                : `Created ambient workflow ${args.name}.`;
            return ok(summary, { workflow, ...(warnings ? { warnings } : {}) });
        }
        catch (e) {
            return fail(String(e));
        }
    });
    server.registerTool("yaaif_ambient_workflow_get", {
        description: "Get an ambient workflow by id.",
        inputSchema: { workflow_id: z.string() },
    }, async ({ workflow_id }) => {
        try {
            return ok("Fetched ambient workflow.", {
                workflow: await ctx.api.agentJSON("GET", `/api/ambient/workflows/${encodeURIComponent(workflow_id)}`),
            });
        }
        catch (e) {
            return fail(String(e));
        }
    });
    server.registerTool("yaaif_ambient_workflow_list", {
        description: "List ambient workflows.",
        inputSchema: { ambient_agent_id: z.string().optional(), q: z.string().optional() },
    }, async ({ ambient_agent_id, q }) => {
        const params = new URLSearchParams();
        if (ambient_agent_id)
            params.set("ambient_agent_id", ambient_agent_id);
        if (q)
            params.set("q", q);
        const path = `/api/ambient/workflows${params.size ? `?${params}` : ""}`;
        try {
            return ok("Listed ambient workflows.", { result: await ctx.api.agentJSON("GET", path) });
        }
        catch (e) {
            return fail(String(e));
        }
    });
    server.registerTool("yaaif_ambient_workflow_update", {
        description: "Update an ambient workflow graph / metadata, including ambient agent assignment.",
        inputSchema: {
            workflow_id: z.string(),
            ambient_agent_id: z.string().optional(),
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
        const body = {};
        for (const [k, v] of Object.entries(rest)) {
            if (v !== undefined)
                body[k] = v;
        }
        try {
            const workflow = await ctx.api.agentJSON("PUT", `/api/ambient/workflows/${encodeURIComponent(workflow_id)}`, body);
            const warnings = args.workflow_graph !== undefined && isEngineSpineOnlyGraph(args.workflow_graph)
                ? [ENGINE_SPINE_ONLY_WARNING]
                : undefined;
            const summary = warnings
                ? `Updated ambient workflow. Warning: ${ENGINE_SPINE_ONLY_WARNING}`
                : "Updated ambient workflow.";
            return ok(summary, { workflow, ...(warnings ? { warnings } : {}) });
        }
        catch (e) {
            return fail(String(e));
        }
    });
    server.registerTool("yaaif_ambient_test_trigger", {
        description: "Fire a test signal against an ambient workflow. The run is attributed to the signed-in user unless user_id is given; only your own runs can use your ambient run-as credential grants.",
        inputSchema: {
            workflow_id: z.string(),
            event_type: z.string(),
            entity_type: z.string(),
            entity_id: z.string(),
            source: z.string().optional(),
            payload: z.record(z.unknown()).optional(),
            user_id: z.string().optional(),
        },
    }, async (args) => {
        try {
            const path = `/api/ambient/workflows/${encodeURIComponent(args.workflow_id)}/test-trigger`;
            // Same default as the admin test-trigger panel: the signed-in user. The
            // server verifies it against the token, so naming someone else only
            // records them as an unverified user.
            const userID = args.user_id?.trim() || (await ctx.auth.session())?.email?.trim() || undefined;
            const result = await ctx.api.agentJSON("POST", path, {
                source: args.source || "manual",
                event_type: args.event_type,
                entity_type: args.entity_type,
                entity_id: args.entity_id,
                user_id: userID,
                payload: args.payload ?? {},
            });
            return ok("Triggered ambient workflow test.", { result });
        }
        catch (e) {
            return fail(String(e));
        }
    });
    server.registerTool("yaaif_ambient_schedule_create", {
        description: "Create a cron schedule that starts an ambient workflow (trigger kind schedule). The fired signal uses signal_event_type / signal_entity_type / signal_entity_id, so they must match one of the workflow's trigger rules. Use enabled=false to stage it.",
        inputSchema: {
            workflow_id: z.string(),
            name: z.string(),
            cron_expr: z.string(),
            timezone: z.string().optional(),
            signal_event_type: z.string(),
            signal_entity_type: z.string(),
            signal_entity_id: z.string().optional(),
            input_vars: z.record(z.unknown()).optional(),
            enabled: z.boolean().optional(),
        },
    }, async (args) => {
        try {
            const trigger = await ctx.api.agentJSON("POST", "/api/triggers", {
                target_type: "ambient_workflow",
                target_id: args.workflow_id,
                kind: "schedule",
                name: args.name,
                enabled: args.enabled ?? true,
                config: {
                    cron_expr: args.cron_expr,
                    ...(args.timezone ? { timezone: args.timezone } : {}),
                    signal_source: "schedule",
                    signal_event_type: args.signal_event_type,
                    signal_entity_type: args.signal_entity_type,
                    ...(args.signal_entity_id ? { signal_entity_id: args.signal_entity_id } : {}),
                    ...(args.input_vars ? { input_vars: args.input_vars } : {}),
                },
            });
            return ok(`Created schedule ${args.name}.`, { trigger });
        }
        catch (e) {
            return fail(String(e));
        }
    });
    server.registerTool("yaaif_ambient_schedules_list", {
        description: "List schedule and other triggers that start an ambient workflow.",
        inputSchema: { workflow_id: z.string().optional() },
    }, async ({ workflow_id }) => {
        const params = new URLSearchParams({ target_type: "ambient_workflow" });
        if (workflow_id)
            params.set("target_id", workflow_id);
        try {
            return ok("Listed workflow triggers.", { result: await ctx.api.agentJSON("GET", `/api/triggers?${params}`) });
        }
        catch (e) {
            return fail(String(e));
        }
    });
    server.registerTool("yaaif_ambient_schedule_set_enabled", {
        description: "Enable or disable one workflow trigger (for example a schedule) by trigger id.",
        inputSchema: { trigger_id: z.string(), enabled: z.boolean() },
    }, async ({ trigger_id, enabled }) => {
        try {
            const trigger = await ctx.api.agentJSON("PATCH", `/api/triggers/${encodeURIComponent(trigger_id)}`, { enabled });
            return ok(`Set enabled=${enabled} on trigger ${trigger_id}.`, { trigger });
        }
        catch (e) {
            return fail(String(e));
        }
    });
    server.registerTool("yaaif_ambient_runs_list", {
        description: "List ambient workflow runs.",
        inputSchema: {
            ambient_agent_id: z.string().optional(),
            ambient_workflow_id: z.string().optional(),
            /** @deprecated use ambient_workflow_id */
            workflow_id: z.string().optional(),
            status: z.string().optional(),
            q: z.string().optional(),
            limit: z.number().optional(),
        },
    }, async (args) => {
        const params = new URLSearchParams();
        if (args.ambient_agent_id)
            params.set("ambient_agent_id", args.ambient_agent_id);
        const workflowID = args.ambient_workflow_id || args.workflow_id;
        if (workflowID)
            params.set("ambient_workflow_id", workflowID);
        if (args.status)
            params.set("status", args.status);
        if (args.q)
            params.set("q", args.q);
        appendClampedLimit(params, args.limit);
        const path = `/api/ambient/runs${params.size ? `?${params}` : ""}`;
        try {
            return ok("Listed ambient runs.", { result: await ctx.api.agentJSON("GET", path) });
        }
        catch (e) {
            return fail(String(e));
        }
    });
    server.registerTool("yaaif_ambient_run_get", {
        description: "Get one ambient run by id.",
        inputSchema: { run_id: z.string() },
    }, async ({ run_id }) => {
        try {
            return ok("Fetched ambient run.", {
                run: await ctx.api.agentJSON("GET", `/api/ambient/runs/${encodeURIComponent(run_id)}`),
            });
        }
        catch (e) {
            return fail(String(e));
        }
    });
}
function registerMcp(server, ctx) {
    server.registerTool("yaaif_mcp_scaffold", {
        description: "Scaffold a new MCP server from official YAA\\F templates into the workspace.",
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
            if (existsSync(dest))
                return fail(`destination already exists: ${dest}`);
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
                    try {
                        execFileSync("bash", [renameScript, name], { cwd: dest, stdio: "inherit" });
                    }
                    catch { /* best-effort */ }
                }
            }
            finally {
                rmSync(tmp, { recursive: true, force: true });
            }
            return ok(`Scaffolded MCP service at ${dest}.`, {
                path: dest,
                name: `${name}-mcp-service`,
                language: lang,
                template: repo,
                next_steps: [
                    "yaaif_deployment_settings_status (confirm method / gitops health)",
                    "Implement tools from contracts",
                    "Build and push container image",
                    "Call yaaif_mcp_deployment_create + deploy + register",
                    "If the MCP calls platform APIs: yaaif_api_key_create + yaaif_api_key_bind_deployment",
                ],
            });
        }
        catch (e) {
            return fail(String(e));
        }
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
            spec_id: z.string().optional(),
            slot_key: z.string().optional(),
        },
    }, async (args) => {
        const body = {
            name: args.name,
            description: args.description ?? "",
            endpoint: args.endpoint,
            transport_type: args.transport_type || "STREAMABLE_HTTP",
            remote_tool_name: args.remote_tool_name || args.name,
            enabled: args.enabled ?? true,
            timeout_seconds: args.timeout_seconds ?? 60,
            command: "",
            command_args: [],
            env: args.env ?? {},
            headers: args.headers ?? {},
        };
        if (args.server_id)
            body.server_id = args.server_id;
        if (args.spec_id)
            body.spec_id = args.spec_id;
        if (args.slot_key)
            body.slot_key = args.slot_key;
        try {
            return ok(`Linked/created MCP tool ${args.name}.`, {
                result: await ctx.api.agentJSON("POST", "/api/mcp-tools/link-or-create", body),
            });
        }
        catch (e) {
            return fail(String(e));
        }
    });
    server.registerTool("yaaif_mcp_server_refresh", {
        description: "Refresh tools from a registered external MCP server.",
        inputSchema: { server_id: z.string() },
    }, async ({ server_id }) => {
        try {
            return ok("Refreshed MCP server tools.", {
                result: await ctx.api.agentJSON("POST", `/api/mcp-tools/servers/${encodeURIComponent(server_id)}/refresh`, {}),
            });
        }
        catch (e) {
            return fail(String(e));
        }
    });
    server.registerTool("yaaif_mcp_tools_list", {
        description: "List external MCP tools in the tenant catalog.",
        inputSchema: { q: z.string().optional(), limit: z.number().optional() },
    }, async ({ q, limit }) => {
        const params = new URLSearchParams();
        if (q)
            params.set("q", q);
        appendClampedLimit(params, limit);
        const path = `/api/mcp-tools${params.size ? `?${params}` : ""}`;
        try {
            return ok("Listed MCP tools.", { result: await ctx.api.agentJSON("GET", path) });
        }
        catch (e) {
            return fail(String(e));
        }
    });
    server.registerTool("yaaif_mcp_tool_get", {
        description: "Get one external MCP tool by id.",
        inputSchema: { tool_id: z.string() },
    }, async ({ tool_id }) => {
        try {
            return ok("Fetched MCP tool.", {
                tool: await ctx.api.agentJSON("GET", `/api/mcp-tools/${encodeURIComponent(tool_id)}`),
            });
        }
        catch (e) {
            return fail(String(e));
        }
    });
    server.registerTool("yaaif_mcp_tool_set_enabled", {
        description: "Enable or disable registered MCP catalog tools without redeploying or re-probing the server. Pass tool_names and/or tool_ids. Optional server_id limits the match to one server. Disabled tools stay registered and leave the agent catalog.",
        inputSchema: {
            enabled: z.boolean(),
            tool_names: z.array(z.string()).optional(),
            tool_ids: z.array(z.string()).optional(),
            server_id: z.string().optional(),
        },
    }, async ({ enabled, tool_names, tool_ids, server_id }) => {
        const names = (tool_names ?? []).map((name) => name.trim()).filter(Boolean);
        const ids = (tool_ids ?? []).map((id) => id.trim()).filter(Boolean);
        if (!names.length && !ids.length)
            return fail("tool_names or tool_ids is required");
        try {
            const result = await ctx.api.agentJSON("POST", "/api/mcp-tools/enabled", {
                enabled,
                tool_names: names,
                tool_ids: ids,
                ...(server_id ? { server_id } : {}),
            });
            const updated = Array.isArray(result?.updated) ? result.updated.length : 0;
            if (!updated)
                return fail("No matching MCP tools.", { result });
            const missing = Array.isArray(result?.missing) ? result.missing : [];
            const summary = missing.length
                ? `Set enabled=${enabled} on ${updated} MCP tool(s). Unmatched: ${missing.join(", ")}.`
                : `Set enabled=${enabled} on ${updated} MCP tool(s).`;
            return ok(summary, { result });
        }
        catch (e) {
            return fail(String(e));
        }
    });
    server.registerTool("yaaif_mcp_tool_delete", {
        description: "Delete one registered MCP catalog tool by id. The server and its other tools stay registered; re-link with yaaif_mcp_link_or_create.",
        inputSchema: { tool_id: z.string() },
    }, async ({ tool_id }) => {
        const id = tool_id.trim();
        if (!id)
            return fail("tool_id is required");
        try {
            await ctx.api.agentJSON("DELETE", `/api/mcp-tools/${encodeURIComponent(id)}`);
            return ok(`Deleted MCP tool ${id}.`, { tool_id: id });
        }
        catch (e) {
            return fail(String(e));
        }
    });
    server.registerTool("yaaif_mcp_servers_list", {
        description: "List registered external MCP servers in the tenant catalog.",
        inputSchema: { q: z.string().optional(), limit: z.number().optional() },
    }, async ({ q, limit }) => {
        const params = new URLSearchParams();
        if (q)
            params.set("q", q);
        appendClampedLimit(params, limit);
        const path = `/api/mcp-tools/servers${params.size ? `?${params}` : ""}`;
        try {
            return ok("Listed MCP servers.", { result: await ctx.api.agentJSON("GET", path) });
        }
        catch (e) {
            return fail(String(e));
        }
    });
    server.registerTool("yaaif_mcp_server_get", {
        description: "Get one external MCP server (and its tools) by id.",
        inputSchema: { server_id: z.string() },
    }, async ({ server_id }) => {
        try {
            return ok("Fetched MCP server.", {
                server: await ctx.api.agentJSON("GET", `/api/mcp-tools/servers/${encodeURIComponent(server_id)}`),
            });
        }
        catch (e) {
            return fail(String(e));
        }
    });
    server.registerTool("yaaif_catalog_overview", {
        description: "Read-only snapshot of the current tenant: agents, skills, MCP tools/servers/deployments, desktop tool packages, API keys, deployment settings status, ambient agents/workflows, local tools, file registry lifecycle (paginated summaries).",
        inputSchema: {
            q: z.string().optional(),
            limit: z.number().optional(),
        },
    }, async ({ q, limit }) => {
        const lim = clampCatalogLimit(limit, 50);
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
            load("mcp_servers", () => ctx.api.agentJSON("GET", `/api/mcp-tools/servers${qs}`)),
            load("mcp_deployments", () => ctx.api.apiJSON("GET", `/api/mcp-deployments${qs}`)),
            load("desktop_tool_packages", () => ctx.api.apiJSON("GET", `/api/desktop/tool-packages${qs}`)),
            load("api_keys", () => ctx.api.apiJSON("GET", "/api/mcp-platform-keys")),
            load("deployment_settings_status", () => ctx.api.apiJSON("GET", "/api/deployment-settings/status")),
            load("ambient_agents", () => ctx.api.agentJSON("GET", `/api/ambient/agents${qs}`)),
            load("ambient_workflows", () => ctx.api.agentJSON("GET", `/api/ambient/workflows${qs}`)),
            load("local_tools", () => ctx.api.agentJSON("GET", "/api/local-tools")),
            load("file_registry_lifecycle", () => ctx.api.agentJSON("GET", "/api/file-attachments/registry-lifecycle")),
        ]);
        if (Object.keys(errors).length)
            out.errors = errors;
        return ok("Catalog overview loaded.", out);
    });
}
