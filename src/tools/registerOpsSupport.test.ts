import assert from "node:assert/strict";
import test from "node:test";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Ctx } from "./ctx.js";
import { registerOpsSupportTools } from "./registerOpsSupport.js";

type RegisteredTool = {
  handler: (args: Record<string, unknown>) => Promise<{
    isError?: boolean;
    content?: Array<{ text?: string }>;
    structuredContent?: Record<string, unknown>;
  }>;
};

function registerTools(): { tools: Map<string, RegisteredTool>; calls: Array<{ method: string; path: string; body?: unknown }> } {
  const tools = new Map<string, RegisteredTool>();
  const calls: Array<{ method: string; path: string; body?: unknown }> = [];
  const server = {
    registerTool(name: string, _definition: unknown, handler: RegisteredTool["handler"]) {
      tools.set(name, { handler });
    },
  } as unknown as McpServer;
  const ctx = {
    api: {
      agentJSON: async (method: string, path: string, body?: unknown) => {
        calls.push({ method, path, body });
        if (method === "GET" && path.startsWith("/api/ops/diagnoses?")) {
          return { items: [], count: 0 };
        }
        if (method === "GET" && path.startsWith("/api/ops/diagnoses/")) {
          return { id: "d1", ambient_run_id: "run-1", title: "Prior" };
        }
        if (method === "POST" && path === "/api/ops/diagnoses") {
          return { id: "d-new", ...(body as object) };
        }
        throw new Error(`unexpected ${method} ${path}`);
      },
    },
    telemetry: { increment: () => undefined },
    cfg: { apiBaseUrl: "https://example.test" },
  } as unknown as Ctx;
  registerOpsSupportTools(server, ctx);
  return { tools, calls };
}

test("yaaif_ops_diagnosis_create requires confirm=true", async () => {
  const { tools, calls } = registerTools();
  const tool = tools.get("yaaif_ops_diagnosis_create");
  assert.ok(tool);
  const result = await tool.handler({
    confirm: false,
    ambient_run_id: "run-1",
    intent: "diagnose_failure",
    severity: "error",
    title: "Failed",
    summary: "Step failed",
    failures: [],
    next_steps: [],
    diagnostics_version: "ops-diagnostics/1",
    evidence_analyze: true,
    source: "cursor",
  });
  assert.equal(result.isError, true);
  assert.match(String(result.content?.[0]?.text ?? ""), /confirm=true/);
  assert.equal(calls.length, 0);
});

test("yaaif_ops_diagnosis_create posts full body when confirmed", async () => {
  const { tools, calls } = registerTools();
  const tool = tools.get("yaaif_ops_diagnosis_create");
  assert.ok(tool);
  const result = await tool.handler({
    confirm: true,
    ambient_run_id: "run-1",
    session_id: "sess-1",
    intent: "diagnose_failure",
    severity: "error",
    title: "Dead-lettered",
    summary: "DLQ",
    failures: [{ code: "dlq_command", title: "DLQ", summary: "exhausted", causes: [], resolutions: [] }],
    next_steps: ["Retry after fix"],
    diagnostics_version: "ops-diagnostics/1",
    evidence_analyze: true,
    evidence_telemetry: ["ambient_logs"],
    source: "cursor",
  });
  assert.equal(result.isError, undefined);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.method, "POST");
  assert.equal(calls[0]?.path, "/api/ops/diagnoses");
  const body = calls[0]?.body as Record<string, unknown>;
  assert.equal(body.ambient_run_id, "run-1");
  assert.equal(body.intent, "diagnose_failure");
  assert.equal(body.evidence_analyze, true);
  assert.deepEqual(body.next_steps, ["Retry after fix"]);
});

test("yaaif_ops_diagnosis_list queries by ambient_run_id", async () => {
  const { tools, calls } = registerTools();
  const tool = tools.get("yaaif_ops_diagnosis_list");
  assert.ok(tool);
  const result = await tool.handler({ ambient_run_id: "run-1", limit: 10 });
  assert.equal(result.isError, undefined);
  assert.equal(calls[0]?.method, "GET");
  assert.match(String(calls[0]?.path), /ambient_run_id=run-1/);
});
