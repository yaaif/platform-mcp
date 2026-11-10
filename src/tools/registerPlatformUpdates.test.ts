import assert from "node:assert/strict";
import test from "node:test";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerPlatformUpdateTools } from "./registerPlatformUpdates.js";
import type { Ctx } from "./ctx.js";

test("platform update tools expose read-only status and job APIs", async () => {
  const tools = new Map<string, { handler: (args: never) => Promise<unknown> }>();
  const calls: Array<{ method: string; path: string }> = [];
  const server = { registerTool(name: string, _schema: unknown, handler: unknown) {
    tools.set(name, { handler: handler as (args: never) => Promise<unknown> });
  } } as unknown as McpServer;
  const ctx = { api: { apiJSON: async (method: string, path: string) => {
    calls.push({ method, path });
    return { ok: true };
  } } } as unknown as Ctx;
  registerPlatformUpdateTools(server, ctx);
  await tools.get("yaaif_platform_update_status")!.handler({} as never);
  await tools.get("yaaif_platform_update_jobs_list")!.handler({ limit: 10 } as never);
  await tools.get("yaaif_platform_update_job_get")!.handler({ job_id: "job/1" } as never);
  assert.deepEqual(calls, [
    { method: "GET", path: "/api/platform-updates/status" },
    { method: "GET", path: "/api/platform-updates/jobs?limit=10" },
    { method: "GET", path: "/api/platform-updates/jobs/job%2F1" },
  ]);
});
