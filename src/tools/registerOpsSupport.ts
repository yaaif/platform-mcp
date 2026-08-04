import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
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

/** Strictly read-only operations support tools (no pause/stop/approve/retry). */
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
      return ok("Correlated ops incident.", { result });
    } catch (e) {
      return fail(String(e));
    }
  });

  server.registerTool("yaaif_ops_analyze", {
    description:
      "READ-ONLY: one-shot incident analysis — correlate IDs, rank failures, and return next_steps for operators.",
    inputSchema: {
      session_id: z.string().optional(),
      ambient_run_id: z.string().optional(),
      desktop_run_id: z.string().optional(),
      request_id: z.string().optional(),
      harness_run_id: z.string().optional(),
      include_raw: z.boolean().optional(),
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
      })}`;
      const result = await ctx.api.agentJSON("GET", path);
      void ctx.telemetry.increment("ops_analyze_ok");
      return ok("Analyzed ops incident.", { result });
    } catch (e) {
      void ctx.telemetry.increment("ops_analyze_fail");
      return fail(String(e));
    }
  });

  server.registerTool("yaaif_ops_session_get", {
    description: "READ-ONLY: LLM/flow session metrics detail + derived failure findings for a session_id.",
    inputSchema: { session_id: z.string() },
  }, async ({ session_id }) => {
    try {
      const result = await ctx.api.agentJSON(
        "GET",
        `/api/ops/sessions/${encodeURIComponent(session_id)}`,
      );
      return ok("Fetched ops session analysis.", { result });
    } catch (e) {
      return fail(String(e));
    }
  });

  server.registerTool("yaaif_ops_ambient_run_get", {
    description: "READ-ONLY: ambient workflow run detail + diagnostic failures for a run_id.",
    inputSchema: { run_id: z.string() },
  }, async ({ run_id }) => {
    try {
      const result = await ctx.api.agentJSON(
        "GET",
        `/api/ops/ambient-runs/${encodeURIComponent(run_id)}`,
      );
      return ok("Fetched ops ambient run analysis.", { result });
    } catch (e) {
      return fail(String(e));
    }
  });

  server.registerTool("yaaif_ops_desktop_run_get", {
    description: "READ-ONLY: desktop worker run detail + failure findings for a run_id.",
    inputSchema: { run_id: z.string() },
  }, async ({ run_id }) => {
    try {
      const result = await ctx.api.agentJSON(
        "GET",
        `/api/ops/desktop-runs/${encodeURIComponent(run_id)}`,
      );
      return ok("Fetched ops desktop run analysis.", { result });
    } catch (e) {
      return fail(String(e));
    }
  });

  server.registerTool("yaaif_ops_desktop_runs_list", {
    description: "READ-ONLY: list desktop runs for a session_id (optional status filter).",
    inputSchema: {
      session_id: z.string(),
      status: z.string().optional(),
    },
  }, async ({ session_id, status }) => {
    try {
      const path = `/api/ops/desktop-runs${opsQuery({ session_id, status })}`;
      const result = await ctx.api.agentJSON("GET", path);
      return ok("Listed ops desktop runs.", { result });
    } catch (e) {
      return fail(String(e));
    }
  });
}
