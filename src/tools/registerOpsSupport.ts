import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { shapeOpsPayload } from "../lib/opsShape.js";
import { extractAmbientRunId, shapeRunPath } from "../lib/runPath.js";
import type { Ctx } from "./ctx.js";
import { fail, ok } from "./helpers.js";

function opsQuery(params: Record<string, string | undefined>): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v && v.trim()) qs.set(k, v.trim());
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

type ShapeOpts = {
  summary_only?: boolean;
  max_chars?: number;
  max_items?: number;
};

async function fetchAmbientRunDetail(ctx: Ctx, runId: string): Promise<unknown | undefined> {
  const id = runId.trim();
  if (!id) {
    return undefined;
  }
  try {
    return await ctx.api.agentJSON("GET", `/api/ambient/runs/${encodeURIComponent(id)}`);
  } catch {
    return undefined;
  }
}

async function attachRunPath(ctx: Ctx, result: unknown, fallbackRunId?: string): Promise<unknown> {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    return result;
  }
  const runId = extractAmbientRunId(result, fallbackRunId);
  const detail = await fetchAmbientRunDetail(ctx, runId);
  const path = shapeRunPath({
    run: detail ?? result,
    apiBaseUrl: ctx.cfg.apiBaseUrl,
    runId,
  });
  if (!path) {
    return result;
  }
  return { ...(result as Record<string, unknown>), run_path: path };
}

function shapedOk(summary: string, result: unknown, opts: ShapeOpts, defaults?: ShapeOpts) {
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

async function fetchTelemetry(
  ctx: Ctx,
  resource: z.infer<typeof telemetryResource>,
  args: {
    session_id?: string;
    request_id?: string;
    desktop_run_id?: string;
    ambient_run_id?: string;
    limit?: number;
    offset?: number;
    include_raw?: boolean;
  },
): Promise<unknown> {
  const q = {
    limit: args.limit != null ? String(args.limit) : undefined,
    offset: args.offset != null ? String(args.offset) : undefined,
    include_raw: args.include_raw ? "true" : undefined,
  };
  switch (resource) {
    case "messages": {
      if (!args.session_id?.trim()) throw new Error("session_id is required for messages");
      return ctx.api.agentJSON(
        "GET",
        `/api/ops/sessions/${encodeURIComponent(args.session_id)}/messages${opsQuery(q)}`,
      );
    }
    case "events": {
      if (!args.session_id?.trim()) throw new Error("session_id is required for events");
      return ctx.api.agentJSON(
        "GET",
        `/api/ops/sessions/${encodeURIComponent(args.session_id)}/events${opsQuery(q)}`,
      );
    }
    case "flow_events": {
      if (!args.request_id?.trim()) throw new Error("request_id is required for flow_events");
      return ctx.api.agentJSON(
        "GET",
        `/api/ops/flow-events${opsQuery({ ...q, request_id: args.request_id })}`,
      );
    }
    case "insights": {
      if (!args.session_id?.trim()) throw new Error("session_id is required for insights");
      const qs = new URLSearchParams();
      for (const id of args.session_id.split(",")) {
        if (id.trim()) qs.append("session_id", id.trim());
      }
      if (args.include_raw) qs.set("include_raw", "true");
      return ctx.api.agentJSON("GET", `/api/ops/flow-session-insights?${qs}`);
    }
    case "desktop_logs": {
      if (!args.desktop_run_id?.trim()) throw new Error("desktop_run_id is required for desktop_logs");
      return ctx.api.agentJSON(
        "GET",
        `/api/ops/desktop-worker-logs${opsQuery({ ...q, desktop_run_id: args.desktop_run_id })}`,
      );
    }
    case "ambient_logs": {
      if (!args.ambient_run_id?.trim()) throw new Error("ambient_run_id is required for ambient_logs");
      return ctx.api.agentJSON(
        "GET",
        `/api/ops/ambient-worker-logs${opsQuery({ ...q, ambient_run_id: args.ambient_run_id })}`,
      );
    }
    default:
      throw new Error(`unknown telemetry resource: ${resource as string}`);
  }
}

/** Operations support tools: read-only analyze/telemetry + confirmed diagnosis write-back. */
export function registerOpsSupportTools(server: McpServer, ctx: Ctx): void {
  server.registerTool("yaaif_ops_correlate", {
    description:
      "READ-ONLY: correlate session_id / ambient_run_id / desktop_run_id / request_id into one incident graph with failure summaries.",
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
    } catch (e) {
      return fail(String(e));
    }
  });

  server.registerTool("yaaif_ops_analyze", {
    description:
      "READ-ONLY: one-shot incident analysis — correlate IDs, rank failures, and return next_steps. When an ambient run is linked, also includes run_path (coverage/path/current step/canvas URL). Prefer this first; then yaaif_ops_telemetry for drill-down.",
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
      const withPath = await attachRunPath(ctx, result, args.ambient_run_id);
      return shapedOk("Analyzed ops incident.", withPath, args, { summary_only: true });
    } catch (e) {
      void ctx.telemetry.increment("ops_analyze_fail");
      return fail(String(e));
    }
  });

  server.registerTool("yaaif_ops_session_get", {
    description: "READ-ONLY: LLM/flow session metrics detail + derived failure findings for a session_id.",
    inputSchema: { session_id: z.string(), ...shapeOptsSchema },
  }, async (args) => {
    try {
      const result = await ctx.api.agentJSON(
        "GET",
        `/api/ops/sessions/${encodeURIComponent(args.session_id)}`,
      );
      return shapedOk("Fetched ops session analysis.", result, args, { summary_only: true });
    } catch (e) {
      return fail(String(e));
    }
  });

  server.registerTool("yaaif_ops_ambient_run_get", {
    description:
      "READ-ONLY: ambient workflow run detail + diagnostic failures for a run_id, plus run_path (coverage/path/current step/canvas URL).",
    inputSchema: { run_id: z.string(), ...shapeOptsSchema },
  }, async (args) => {
    try {
      const result = await ctx.api.agentJSON(
        "GET",
        `/api/ops/ambient-runs/${encodeURIComponent(args.run_id)}`,
      );
      const withPath = await attachRunPath(ctx, result, args.run_id);
      return shapedOk("Fetched ops ambient run analysis.", withPath, args, { summary_only: true });
    } catch (e) {
      return fail(String(e));
    }
  });

  server.registerTool("yaaif_ops_desktop_run_get", {
    description: "READ-ONLY: desktop worker run detail + failure findings for a run_id.",
    inputSchema: { run_id: z.string(), ...shapeOptsSchema },
  }, async (args) => {
    try {
      const result = await ctx.api.agentJSON(
        "GET",
        `/api/ops/desktop-runs/${encodeURIComponent(args.run_id)}`,
      );
      return shapedOk("Fetched ops desktop run analysis.", result, args, { summary_only: true });
    } catch (e) {
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
    } catch (e) {
      return fail(String(e));
    }
  });

  server.registerTool("yaaif_ops_telemetry", {
    description:
      "READ-ONLY: unified telemetry drill-down via agent-service /api/ops (proxies telemetry-service). resource=messages|events|flow_events|insights|desktop_logs|ambient_logs. Prefer after yaaif_ops_analyze.",
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
    } catch (e) {
      void ctx.telemetry.increment("ops_telemetry_fail");
      return fail(String(e));
    }
  });

  // Thin aliases — prefer yaaif_ops_telemetry for new agent flows.
  const alias = (
    name: string,
    resource: z.infer<typeof telemetryResource>,
    idField: "session_id" | "request_id" | "desktop_run_id" | "ambient_run_id",
    description: string,
  ) => {
    server.registerTool(name, {
      description: `${description} Alias of yaaif_ops_telemetry resource=${resource}.`,
      inputSchema: {
        [idField]: z.string(),
        limit: z.number().int().positive().optional(),
        offset: z.number().int().nonnegative().optional(),
        include_raw: z.boolean().optional(),
        ...shapeOptsSchema,
      } as Record<string, z.ZodTypeAny>,
    }, async (args: Record<string, unknown>) => {
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
      } catch (e) {
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
    description:
      "READ-ONLY: flow-session insights. Alias of yaaif_ops_telemetry resource=insights.",
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
    } catch (e) {
      return fail(String(e));
    }
  });

  const diagnosisFailureSchema = z.object({
    source: z.string().optional(),
    severity: z.string().optional(),
    code: z.string().optional(),
    title: z.string().optional(),
    summary: z.string().optional(),
    causes: z.array(z.string()).optional(),
    resolutions: z.array(z.string()).optional(),
  });

  server.registerTool("yaaif_ops_diagnosis_list", {
    description:
      "READ-ONLY: list prior confirmed ops diagnoses (newest first). Provide exactly one of ambient_run_id, session_id, or desktop_run_id. Call before yaaif_ops_analyze so prior findings inform triage.",
    inputSchema: {
      ambient_run_id: z.string().optional(),
      session_id: z.string().optional(),
      desktop_run_id: z.string().optional(),
      limit: z.number().int().positive().optional(),
      ...shapeOptsSchema,
    },
  }, async (args) => {
    try {
      const path = `/api/ops/diagnoses${opsQuery({
        ambient_run_id: args.ambient_run_id,
        session_id: args.session_id,
        desktop_run_id: args.desktop_run_id,
        limit: args.limit != null ? String(args.limit) : undefined,
      })}`;
      const result = await ctx.api.agentJSON("GET", path);
      return shapedOk("Listed prior ops diagnoses.", result, args);
    } catch (e) {
      return fail(String(e));
    }
  });

  server.registerTool("yaaif_ops_diagnosis_get", {
    description: "READ-ONLY: fetch one confirmed ops diagnosis by id.",
    inputSchema: {
      id: z.string(),
      ...shapeOptsSchema,
    },
  }, async (args) => {
    try {
      const result = await ctx.api.agentJSON(
        "GET",
        `/api/ops/diagnoses/${encodeURIComponent(args.id)}`,
      );
      return shapedOk("Fetched ops diagnosis.", result, args);
    } catch (e) {
      return fail(String(e));
    }
  });

  server.registerTool("yaaif_ops_diagnosis_create", {
    description:
      "Write a confirmed OpsDiagnosisRecord back to YAAIF (append-only). Requires confirm=true after presenting the full draft to the user. Does not pause/stop/approve/retry runs. Requires ops.support.write.",
    inputSchema: {
      confirm: z.boolean().describe("Must be true after explicit user confirmation"),
      ambient_run_id: z.string(),
      session_id: z.string().optional(),
      desktop_run_id: z.string().optional(),
      harness_run_id: z.string().optional(),
      request_ids: z.array(z.string()).optional(),
      intent: z.enum(["diagnose_failure", "inspect_run"]),
      severity: z.enum(["error", "warning", "info", "ok"]),
      title: z.string(),
      summary: z.string(),
      status_session: z.string().optional(),
      status_ambient: z.string().optional(),
      status_desktop: z.string().optional(),
      status_harness: z.string().optional(),
      failures: z.array(diagnosisFailureSchema),
      next_steps: z.array(z.string()),
      coverage_reached: z.number().int().optional(),
      coverage_total: z.number().int().optional(),
      path_executed: z.number().int().optional(),
      path_reached: z.number().int().optional(),
      current_step_id: z.string().optional(),
      current_step_status: z.string().optional(),
      canvas_url: z.string().optional(),
      diagnostics_version: z.string(),
      evidence_analyze: z.boolean(),
      evidence_telemetry: z.array(z.string()).optional(),
      partial_errors: z.record(z.string(), z.string()).optional(),
      source: z.enum(["cursor", "vscode", "intellij", "codex", "claude-code", "admin_ui"]),
      ide_client: z.string().optional(),
      diagnosed_at: z.string().optional().describe("RFC3339 timestamp; server may normalize"),
    },
  }, async (args) => {
    if (!args.confirm) {
      return fail(
        "Set confirm=true only after presenting the full OpsDiagnosisRecord draft to the user and receiving explicit confirmation to write it back to YAAIF.",
      );
    }
    try {
      const body: Record<string, unknown> = {
        ambient_run_id: args.ambient_run_id,
        session_id: args.session_id,
        desktop_run_id: args.desktop_run_id,
        harness_run_id: args.harness_run_id,
        request_ids: args.request_ids ?? [],
        intent: args.intent,
        severity: args.severity,
        title: args.title,
        summary: args.summary,
        status_session: args.status_session ?? "",
        status_ambient: args.status_ambient ?? "",
        status_desktop: args.status_desktop ?? "",
        status_harness: args.status_harness ?? "",
        failures: (args.failures ?? []).map((failure) => ({
          source: failure.source ?? "",
          severity: failure.severity ?? "",
          code: failure.code ?? "",
          title: failure.title ?? "",
          summary: failure.summary ?? "",
          causes: failure.causes ?? [],
          resolutions: failure.resolutions ?? [],
        })),
        next_steps: args.next_steps ?? [],
        coverage_reached: args.coverage_reached ?? 0,
        coverage_total: args.coverage_total ?? 0,
        path_executed: args.path_executed ?? 0,
        path_reached: args.path_reached ?? 0,
        current_step_id: args.current_step_id ?? "",
        current_step_status: args.current_step_status ?? "",
        canvas_url: args.canvas_url ?? "",
        diagnostics_version: args.diagnostics_version,
        evidence_analyze: args.evidence_analyze,
        evidence_telemetry: args.evidence_telemetry ?? [],
        partial_errors: args.partial_errors ?? {},
        source: args.source,
        ide_client: args.ide_client ?? "",
      };
      if (args.diagnosed_at?.trim()) {
        body.diagnosed_at = args.diagnosed_at.trim();
      }
      const result = await ctx.api.agentJSON("POST", "/api/ops/diagnoses", body);
      void ctx.telemetry.increment("ops_diagnosis_create_ok");
      return ok("Persisted ops diagnosis to YAAIF.", { diagnosis: result });
    } catch (e) {
      void ctx.telemetry.increment("ops_diagnosis_create_fail");
      return fail(String(e));
    }
  });
}
