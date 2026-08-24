import { z } from "zod";
import { fail, ok } from "./helpers.js";
export function registerDesktopTools(server, ctx) {
    server.registerTool("yaaif_desktop_workers_list", {
        description: "List desktop workers in the tenant (control-plane).",
        inputSchema: { q: z.string().optional(), limit: z.number().optional() },
    }, async ({ q, limit }) => {
        const params = new URLSearchParams();
        if (q)
            params.set("q", q);
        if (limit)
            params.set("limit", String(limit));
        const path = `/api/desktop/workers${params.size ? `?${params}` : ""}`;
        try {
            return ok("Listed desktop workers.", {
                result: await ctx.api.controlPlaneJSON("GET", path),
            });
        }
        catch (e) {
            return fail(String(e));
        }
    });
    server.registerTool("yaaif_desktop_skill_mappings_list", {
        description: "List desktop worker↔skill mappings (control-plane).",
        inputSchema: { skill_id: z.string().optional() },
    }, async ({ skill_id }) => {
        const params = new URLSearchParams();
        if (skill_id)
            params.set("skill_id", skill_id);
        const path = `/api/desktop/skill-mappings${params.size ? `?${params}` : ""}`;
        try {
            return ok("Listed desktop skill mappings.", {
                result: await ctx.api.controlPlaneJSON("GET", path),
            });
        }
        catch (e) {
            return fail(String(e));
        }
    });
    server.registerTool("yaaif_desktop_skill_mapping_set", {
        description: "Replace worker ids mapped to a desktop skill (control-plane PUT). Optionally trace this external dependency to a Scenario slot; attach evidence/attestation before activation.",
        inputSchema: {
            skill_id: z.string(),
            worker_ids: z.array(z.string()),
            spec_id: z.string().optional(),
            slot_key: z.string().optional(),
            spec_version: z.number().int().positive().optional(),
        },
    }, async ({ skill_id, worker_ids, spec_id, slot_key, spec_version }) => {
        try {
            const mapping = await ctx.api.controlPlaneJSON("PUT", `/api/desktop/skill-mappings/${encodeURIComponent(skill_id)}`, { worker_ids });
            let scenario_binding;
            if (spec_id && slot_key && spec_version) {
                scenario_binding = await ctx.api.agentJSON("POST", `/api/agent-specs/${encodeURIComponent(spec_id)}/bindings`, {
                    expected_version: spec_version, slot_key, kind: "desktop_mapping", entity_id: skill_id,
                    entity_name: skill_id, source: "cursor_plugin",
                });
            }
            return ok(`Mapped skill ${skill_id} to ${worker_ids.length} worker(s).`, { mapping, ...(scenario_binding ? { scenario_binding } : {}) });
        }
        catch (e) {
            return fail(String(e));
        }
    });
    server.registerTool("yaaif_desktop_skill_mapping_delete", {
        description: "Delete desktop worker↔skill mapping for a skill id.",
        inputSchema: { skill_id: z.string() },
    }, async ({ skill_id }) => {
        try {
            await ctx.api.controlPlaneJSON("DELETE", `/api/desktop/skill-mappings/${encodeURIComponent(skill_id)}`);
            return ok(`Deleted desktop skill mapping for ${skill_id}.`, { skill_id, deleted: true });
        }
        catch (e) {
            return fail(String(e));
        }
    });
}
