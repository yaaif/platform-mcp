import assert from "node:assert/strict";
import test from "node:test";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerWikiTools } from "./registerWiki.js";
import type { Ctx } from "./ctx.js";

function setup() {
  const tools = new Map<string, { handler: (args: never) => Promise<unknown> }>();
  const calls: Array<{ method: string; path: string }> = [];
  const server = { registerTool(name: string, _schema: unknown, handler: unknown) {
    tools.set(name, { handler: handler as (args: never) => Promise<unknown> });
  } } as unknown as McpServer;
  const ctx = { api: { apiJSON: async (method: string, path: string) => {
    calls.push({ method, path });
    return { ok: true };
  } } } as unknown as Ctx;
  registerWikiTools(server, ctx);
  return { tools, calls };
}

test("Wiki page search forwards read-only filters and pagination", async () => {
  const { tools, calls } = setup();
  const result = await tools.get("yaaif_wiki_pages_list")!.handler({
    q: "refund", type: ["concept", "entity"], status: ["active"], scope: "common", min_confidence: 0.7, limit: 25, offset: 50,
  } as never);
  assert.equal((result as { isError?: boolean }).isError, undefined);
  assert.deepEqual(calls, [{ method: "GET", path: "/api/wiki/pages?limit=25&offset=50&q=refund&scope=common&min_confidence=0.7&type=concept%2Centity&status=active" }]);
});

test("Wiki graph and rebuild inspection use GET only", async () => {
  const { tools, calls } = setup();
  await tools.get("yaaif_wiki_graph")!.handler({ center: "orders", hops: 2, rel: ["depends_on"], skills: true, limit: 100 } as never);
  await tools.get("yaaif_wiki_rebuild_preview")!.handler({} as never);
  await tools.get("yaaif_wiki_rebuild_get")!.handler({ run_id: "run/1" } as never);
  assert.deepEqual(calls, [
    { method: "GET", path: "/api/wiki/graph?center=orders&hops=2&limit=100&skills=1&rel=depends_on" },
    { method: "GET", path: "/api/wiki/rebuild/preview" },
    { method: "GET", path: "/api/wiki/rebuild/runs/run%2F1" },
  ]);
});
