import { z } from "zod";
import { fail, ok } from "./helpers.js";
function defaultStrategyDefinition(objectType, approverEmail) {
    return {
        object_type: objectType,
        conditions: [],
        stages: [
            {
                stage_order: 1,
                name: "Approve",
                mode: "sequential",
                allow_delegate: false,
                sla_hours: 24,
                nodes: [
                    {
                        node_order: 1,
                        name: "Primary approver",
                        approver_source_type: "user",
                        approver_source_ref: approverEmail,
                        completion_rule: "any",
                        allow_delegate: false,
                        sla_hours: 24,
                    },
                ],
            },
        ],
    };
}
export function registerApprovalTools(server, ctx) {
    server.registerTool("yaaif_approval_strategies_list", {
        description: "List approval strategies (approval-service).",
        inputSchema: {
            limit: z.number().optional(),
            offset: z.number().optional(),
        },
    }, async ({ limit, offset }) => {
        const params = new URLSearchParams();
        if (limit)
            params.set("limit", String(limit));
        if (offset)
            params.set("offset", String(offset));
        const path = `/api/approval/strategies${params.size ? `?${params}` : ""}`;
        try {
            return ok("Listed approval strategies.", {
                result: await ctx.api.approvalJSON("GET", path),
            });
        }
        catch (e) {
            return fail(String(e));
        }
    });
    server.registerTool("yaaif_approval_strategy_get", {
        description: "Get one approval strategy by id.",
        inputSchema: { strategy_id: z.string() },
    }, async ({ strategy_id }) => {
        try {
            return ok("Fetched approval strategy.", {
                strategy: await ctx.api.approvalJSON("GET", `/api/approval/strategies/${encodeURIComponent(strategy_id)}`),
            });
        }
        catch (e) {
            return fail(String(e));
        }
    });
    server.registerTool("yaaif_approval_strategy_create", {
        description: "Create an approval strategy (draft). Optionally publish version 1. Use for ambient Linear+approval graphs.",
        inputSchema: {
            name: z.string(),
            object_type: z.string().optional(),
            description: z.string().optional(),
            priority: z.number().optional(),
            approver_email: z.string().optional(),
            definition: z.record(z.unknown()).optional(),
            publish: z.boolean().optional(),
        },
    }, async (args) => {
        const objectType = (args.object_type || "WORKFLOW_PAUSE").toUpperCase();
        let definition = args.definition;
        if (!definition) {
            const email = (args.approver_email || "").trim();
            if (!email) {
                return fail("approver_email is required when definition is omitted");
            }
            definition = defaultStrategyDefinition(objectType, email);
        }
        const body = {
            name: args.name,
            object_type: objectType,
            description: args.description ?? "",
            priority: args.priority ?? 100,
            definition,
        };
        try {
            const created = await ctx.api.approvalJSON("POST", "/api/approval/strategies", body);
            let published;
            if (args.publish) {
                const strategy = created.strategy;
                const strategyId = strategy?.id;
                if (strategyId) {
                    published = await ctx.api.approvalJSON("POST", `/api/approval/strategies/${encodeURIComponent(strategyId)}/versions/1/publish`, {});
                }
            }
            return ok(`Created approval strategy ${args.name}.`, {
                created,
                published,
                approval_strategy_id: created.strategy?.id,
            });
        }
        catch (e) {
            return fail(String(e));
        }
    });
    server.registerTool("yaaif_approval_strategy_publish", {
        description: "Publish an approval strategy version (required before ambient graphs resolve it).",
        inputSchema: {
            strategy_id: z.string(),
            version: z.number().optional(),
        },
    }, async ({ strategy_id, version }) => {
        const ver = version && version > 0 ? version : 1;
        try {
            return ok(`Published strategy ${strategy_id} v${ver}.`, {
                result: await ctx.api.approvalJSON("POST", `/api/approval/strategies/${encodeURIComponent(strategy_id)}/versions/${ver}/publish`, {}),
            });
        }
        catch (e) {
            return fail(String(e));
        }
    });
}
