import { z } from "zod";
import { fail, ok } from "./helpers.js";
export function registerOpsTools(server, ctx) {
    const decisionBody = {
        note: z.string().optional(),
        decided_by: z.string().optional(),
    };
    server.registerTool("yaaif_ambient_run_pause", {
        description: "Pause an ambient run (agent-service).",
        inputSchema: { run_id: z.string() },
    }, async ({ run_id }) => {
        try {
            return ok(`Paused run ${run_id}.`, {
                run: await ctx.api.agentJSON("POST", `/api/ambient/runs/${encodeURIComponent(run_id)}/pause`),
            });
        }
        catch (e) {
            return fail(String(e));
        }
    });
    server.registerTool("yaaif_ambient_run_resume", {
        description: "Resume a paused ambient run.",
        inputSchema: { run_id: z.string() },
    }, async ({ run_id }) => {
        try {
            return ok(`Resumed run ${run_id}.`, {
                run: await ctx.api.agentJSON("POST", `/api/ambient/runs/${encodeURIComponent(run_id)}/resume`),
            });
        }
        catch (e) {
            return fail(String(e));
        }
    });
    server.registerTool("yaaif_ambient_run_approve", {
        description: "Approve an ambient run gate (agent-service). If managed by approval-service, use yaaif_approval_task_decide instead.",
        inputSchema: { run_id: z.string(), ...decisionBody },
    }, async ({ run_id, note, decided_by }) => {
        try {
            return ok(`Approved run ${run_id}.`, {
                run: await ctx.api.agentJSON("POST", `/api/ambient/runs/${encodeURIComponent(run_id)}/approve`, { note, decided_by }),
            });
        }
        catch (e) {
            return fail(String(e));
        }
    });
    server.registerTool("yaaif_ambient_run_reject", {
        description: "Reject an ambient run gate (agent-service).",
        inputSchema: { run_id: z.string(), ...decisionBody },
    }, async ({ run_id, note, decided_by }) => {
        try {
            return ok(`Rejected run ${run_id}.`, {
                run: await ctx.api.agentJSON("POST", `/api/ambient/runs/${encodeURIComponent(run_id)}/reject`, { note, decided_by }),
            });
        }
        catch (e) {
            return fail(String(e));
        }
    });
    server.registerTool("yaaif_ambient_run_stop", {
        description: "Stop an ambient run.",
        inputSchema: { run_id: z.string(), ...decisionBody },
    }, async ({ run_id, note, decided_by }) => {
        try {
            return ok(`Stopped run ${run_id}.`, {
                run: await ctx.api.agentJSON("POST", `/api/ambient/runs/${encodeURIComponent(run_id)}/stop`, { note, decided_by }),
            });
        }
        catch (e) {
            return fail(String(e));
        }
    });
    server.registerTool("yaaif_approval_inbox_list", {
        description: "List approval inbox tasks (approval-service).",
        inputSchema: {
            status_scope: z.string().optional(),
            limit: z.number().optional(),
            offset: z.number().optional(),
        },
    }, async ({ status_scope, limit, offset }) => {
        const params = new URLSearchParams();
        if (status_scope)
            params.set("status_scope", status_scope);
        if (limit)
            params.set("limit", String(limit));
        if (offset)
            params.set("offset", String(offset));
        const path = `/api/approval/inbox/tasks${params.size ? `?${params}` : ""}`;
        try {
            return ok("Listed approval inbox tasks.", {
                result: await ctx.api.approvalJSON("GET", path),
            });
        }
        catch (e) {
            return fail(String(e));
        }
    });
    server.registerTool("yaaif_approval_task_claim", {
        description: "Claim an approval inbox task.",
        inputSchema: { task_id: z.string() },
    }, async ({ task_id }) => {
        try {
            return ok(`Claimed task ${task_id}.`, {
                result: await ctx.api.approvalJSON("POST", `/api/approval/tasks/${encodeURIComponent(task_id)}/claim`),
            });
        }
        catch (e) {
            return fail(String(e));
        }
    });
    server.registerTool("yaaif_approval_task_decide", {
        description: "Decide an approval task (approve|reject|request_clarification|send_back).",
        inputSchema: {
            task_id: z.string(),
            decision: z.string(),
            comment: z.string().optional(),
            channel: z.string().optional(),
            idempotency_key: z.string().optional(),
            claim_first: z.boolean().optional(),
        },
    }, async ({ task_id, decision, comment, channel, idempotency_key, claim_first }) => {
        try {
            if (claim_first) {
                try {
                    await ctx.api.approvalJSON("POST", `/api/approval/tasks/${encodeURIComponent(task_id)}/claim`);
                }
                catch { /* may already be claimed */ }
            }
            return ok(`Decision ${decision} on task ${task_id}.`, {
                result: await ctx.api.approvalJSON("POST", `/api/approval/tasks/${encodeURIComponent(task_id)}/decide`, { decision, comment, channel: channel || "admin", idempotency_key }),
            });
        }
        catch (e) {
            return fail(String(e));
        }
    });
}
