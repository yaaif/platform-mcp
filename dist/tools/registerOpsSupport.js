import { z } from "zod";
import { shapeOpsPayload } from "../lib/opsShape.js";
import { fail, ok } from "./helpers.js";
function opsQuery(params) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
        if (v && v.trim())
            qs.set(k, v.trim());
    }
    const s = qs.toString();
    return s ? `?${s}` : "";
}
const shapeOptsSchema = {
    summary_only: z
        .boolean()
        .optional()
        .describe("Prefer compact links/failures (default true for analyze)"),
    max_chars: z.number().int().positive().optional().describe("Soft JSON size cap for the tool result"),
    max_items: z.number().int().positive().optional().describe("Cap items/events/logs arrays (default 40)"),
};
function shapedOk(summary, result, opts, defaults) {
    const merged = {
        summary_only: opts.summary_only ?? defaults?.summary_only,
        max_chars: opts.max_chars ?? defaults?.max_chars,
        max_items: opts.max_items ?? defaults?.max_items,
    };
    return ok(summary, { result: shapeOpsPayload(result, merged) });
}
const telemetryResource = z.enum([
    "messages",
    "events",
    "flow_events",
    "insights",
    "desktop_logs",
    "ambient_logs",
]);
async function fetchTelemetry(ctx, resource, args) {
    const q = {
        limit: args.limit != null ? String(args.limit) : undefined,
        offset: args.offset != null ? String(args.offset) : undefined,
        include_raw: args.include_raw ? "true" : undefined,
    };
    switch (resource) {
        case "messages": {
            if (!args.session_id?.trim())
                throw new Error("session_id is required for messages");
            return ctx.api.agentJSON("GET", `/api/ops/sessions/${encodeURIComponent(args.session_id)}/messages${opsQuery(q)}`);
        }
        case "events": {
            if (!args.session_id?.trim())
                throw new Error("session_id is required for events");
            return ctx.api.agentJSON("GET", `/api/ops/sessions/${encodeURIComponent(args.session_id)}/events${opsQuery(q)}`);
        }
        case "flow_events": {
            if (!args.request_id?.trim())
                throw new Error("request_id is required for flow_events");
            return ctx.api.agentJSON("GET", `/api/ops/flow-events${opsQuery({ ...q, request_id: args.request_id })}`);
        }
        case "insights": {
            if (!args.session_id?.trim())
                throw new Error("session_id is required for insights");
            const qs = new URLSearchParams();
            for (const id of args.session_id.split(",")) {
                if (id.trim())
                    qs.append("session_id", id.trim());
            }
            if (args.include_raw)
                qs.set("include_raw", "true");
            return ctx.api.agentJSON("GET", `/api/ops/flow-session-insights?${qs}`);
        }
        case "desktop_logs": {
            if (!args.desktop_run_id?.trim())
                throw new Error("desktop_run_id is required for desktop_logs");
            return ctx.api.agentJSON("GET", `/api/ops/desktop-worker-logs${opsQuery({ ...q, desktop_run_id: args.desktop_run_id })}`);
        }
        case "ambient_logs": {
            if (!args.ambient_run_id?.trim())
                throw new Error("ambient_run_id is required for ambient_logs");
            return ctx.api.agentJSON("GET", `/api/ops/ambient-worker-logs${opsQuery({ ...q, ambient_run_id: args.ambient_run_id })}`);
        }
        default:
            throw new Error(`unknown telemetry resource: ${resource}`);
    }
}
/** Strictly read-only operations support tools (no pause/stop/approve/retry). */
export function registerOpsSupportTools(server, ctx) {
    server.registerTool("yaaif_ops_correlate", {
        description: "READ-ONLY: correlate session_id / ambient_run_id / desktop_run_id / request_id into one incident graph with failure summaries.",
        inputSchema: {
            session_id: z.string().optional(),
            ambient_run_id: z.string().optional(),
            desktop_run_id: z.string().optional(),
            request_id: z.string().optional(),
            harness_run_id: z.string().optional(),
            include_raw: z.boolean().optional(),
            analyze: z.boolean().optional(),
            ...shapeOptsSchema,
        },
    }, async (args) => {
        try {
            const path = `/api/ops/correlate${opsQuery({
                session_id: args.session_id,
                ambient_run_id: args.ambient_run_id,
                desktop_run_id: args.desktop_run_id,
                request_id: args.request_id,
                harness_run_id: args.harness_run_id,
                include_raw: args.include_raw ? "true" : undefined,
                analyze: args.analyze ? "true" : undefined,
            })}`;
            const result = await ctx.api.agentJSON("GET", path);
            return shapedOk("Correlated ops incident.", result, args, { summary_only: true });
        }
        catch (e) {
            return fail(String(e));
        }
    });
    server.registerTool("yaaif_ops_analyze", {
        description: "READ-ONLY: one-shot incident analysis — correlate IDs, rank failures, and return next_steps. Prefer this first; then yaaif_ops_telemetry for drill-down.",
        inputSchema: {
            session_id: z.string().optional(),
            ambient_run_id: z.string().optional(),
            desktop_run_id: z.string().optional(),
            request_id: z.string().optional(),
            harness_run_id: z.string().optional(),
            include_raw: z.boolean().optional().describe("Requires ops.support.raw; default false"),
            include_live_diag: z.boolean().optional(),
            ...shapeOptsSchema,
        },
    }, async (args) => {
        try {
            const path = `/api/ops/analyze${opsQuery({
                session_id: args.session_id,
                ambient_run_id: args.ambient_run_id,
                desktop_run_id: args.desktop_run_id,
                request_id: args.request_id,
                harness_run_id: args.harness_run_id,
                include_raw: args.include_raw ? "true" : undefined,
                include_live_diag: args.include_live_diag ? "true" : undefined,
            })}`;
            const result = await ctx.api.agentJSON("GET", path);
            void ctx.telemetry.increment("ops_analyze_ok");
            return shapedOk("Analyzed ops incident.", result, args, { summary_only: true });
        }
        catch (e) {
            void ctx.telemetry.increment("ops_analyze_fail");
            return fail(String(e));
        }
    });
    server.registerTool("yaaif_ops_session_get", {
        description: "READ-ONLY: LLM/flow session metrics detail + derived failure findings for a session_id.",
        inputSchema: { session_id: z.string(), ...shapeOptsSchema },
    }, async (args) => {
        try {
            const result = await ctx.api.agentJSON("GET", `/api/ops/sessions/${encodeURIComponent(args.session_id)}`);
            return shapedOk("Fetched ops session analysis.", result, args, { summary_only: true });
        }
        catch (e) {
            return fail(String(e));
        }
    });
    server.registerTool("yaaif_ops_ambient_run_get", {
        description: "READ-ONLY: ambient workflow run detail + diagnostic failures for a run_id.",
        inputSchema: { run_id: z.string(), ...shapeOptsSchema },
    }, async (args) => {
        try {
            const result = await ctx.api.agentJSON("GET", `/api/ops/ambient-runs/${encodeURIComponent(args.run_id)}`);
            return shapedOk("Fetched ops ambient run analysis.", result, args, { summary_only: true });
        }
        catch (e) {
            return fail(String(e));
        }
    });
    server.registerTool("yaaif_ops_desktop_run_get", {
        description: "READ-ONLY: desktop worker run detail + failure findings for a run_id.",
        inputSchema: { run_id: z.string(), ...shapeOptsSchema },
    }, async (args) => {
        try {
            const result = await ctx.api.agentJSON("GET", `/api/ops/desktop-runs/${encodeURIComponent(args.run_id)}`);
            return shapedOk("Fetched ops desktop run analysis.", result, args, { summary_only: true });
        }
        catch (e) {
            return fail(String(e));
        }
    });
    server.registerTool("yaaif_ops_desktop_runs_list", {
        description: "READ-ONLY: list desktop runs for a session_id (optional status filter).",
        inputSchema: {
            session_id: z.string(),
            status: z.string().optional(),
            ...shapeOptsSchema,
        },
    }, async (args) => {
        try {
            const path = `/api/ops/desktop-runs${opsQuery({ session_id: args.session_id, status: args.status })}`;
            const result = await ctx.api.agentJSON("GET", path);
            return shapedOk("Listed ops desktop runs.", result, args);
        }
        catch (e) {
            return fail(String(e));
        }
    });
    server.registerTool("yaaif_ops_telemetry", {
        description: "READ-ONLY: unified telemetry drill-down via agent-service /api/ops (proxies telemetry-service). resource=messages|events|flow_events|insights|desktop_logs|ambient_logs. Prefer after yaaif_ops_analyze.",
        inputSchema: {
            resource: telemetryResource,
            session_id: z.string().optional().describe("Required for messages, events, insights (comma-separated ok for insights)"),
            request_id: z.string().optional().describe("Required for flow_events"),
            desktop_run_id: z.string().optional().describe("Required for desktop_logs"),
            ambient_run_id: z.string().optional().describe("Required for ambient_logs"),
            limit: z.number().int().positive().optional(),
            offset: z.number().int().nonnegative().optional(),
            include_raw: z.boolean().optional(),
            ...shapeOptsSchema,
        },
    }, async (args) => {
        try {
            const result = await fetchTelemetry(ctx, args.resource, args);
            void ctx.telemetry.increment("ops_telemetry_ok");
            return shapedOk(`Fetched ops telemetry (${args.resource}).`, result, args);
        }
        catch (e) {
            void ctx.telemetry.increment("ops_telemetry_fail");
            return fail(String(e));
        }
    });
    // Thin aliases — prefer yaaif_ops_telemetry for new agent flows.
    const alias = (name, resource, idField, description) => {
        server.registerTool(name, {
            description: `${description} Alias of yaaif_ops_telemetry resource=${resource}.`,
            inputSchema: {
                [idField]: z.string(),
                limit: z.number().int().positive().optional(),
                offset: z.number().int().nonnegative().optional(),
                include_raw: z.boolean().optional(),
                ...shapeOptsSchema,
            },
        }, async (args) => {
            try {
                const result = await fetchTelemetry(ctx, resource, {
                    session_id: typeof args.session_id === "string" ? args.session_id : undefined,
                    request_id: typeof args.request_id === "string" ? args.request_id : undefined,
                    desktop_run_id: typeof args.desktop_run_id === "string" ? args.desktop_run_id : undefined,
                    ambient_run_id: typeof args.ambient_run_id === "string" ? args.ambient_run_id : undefined,
                    limit: typeof args.limit === "number" ? args.limit : undefined,
                    offset: typeof args.offset === "number" ? args.offset : undefined,
                    include_raw: Boolean(args.include_raw),
                });
                return shapedOk(`Fetched ops telemetry (${resource}).`, result, {
                    summary_only: Boolean(args.summary_only),
                    max_chars: typeof args.max_chars === "number" ? args.max_chars : undefined,
                    max_items: typeof args.max_items === "number" ? args.max_items : undefined,
                });
            }
            catch (e) {
                return fail(String(e));
            }
        });
    };
    alias("yaaif_ops_session_messages", "messages", "session_id", "READ-ONLY: LLM transcript messages.");
    alias("yaaif_ops_session_events", "events", "session_id", "READ-ONLY: LLM session events.");
    alias("yaaif_ops_flow_events", "flow_events", "request_id", "READ-ONLY: flow-events by request_id.");
    alias("yaaif_ops_desktop_worker_logs", "desktop_logs", "desktop_run_id", "READ-ONLY: desktop worker logs.");
    alias("yaaif_ops_ambient_worker_logs", "ambient_logs", "ambient_run_id", "READ-ONLY: ambient worker logs.");
    server.registerTool("yaaif_ops_session_insights", {
        description: "READ-ONLY: flow-session insights. Alias of yaaif_ops_telemetry resource=insights.",
        inputSchema: {
            session_id: z.union([z.string(), z.array(z.string())]),
            include_raw: z.boolean().optional(),
            ...shapeOptsSchema,
        },
    }, async (args) => {
        try {
            const ids = Array.isArray(args.session_id) ? args.session_id.join(",") : args.session_id;
            const result = await fetchTelemetry(ctx, "insights", {
                session_id: ids,
                include_raw: args.include_raw,
            });
            return shapedOk("Fetched ops session insights.", result, args);
        }
        catch (e) {
            return fail(String(e));
        }
    });
}
