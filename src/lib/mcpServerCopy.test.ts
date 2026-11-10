import assert from "node:assert/strict";
import test from "node:test";
import type { Runtime } from "../runtime.js";
import { copyMcpServer } from "./mcpServerCopy.js";

function runtime(profile: string, calls: Array<{ method: string; path: string; body?: unknown }>, conflict = false): Runtime {
  return {
    cfg: { activeProfileId: profile },
    api: {
      agentJSON: async (method: string, path: string, body?: unknown) => {
        calls.push({ method, path, body });
        if (path === "/api/mcp-tools/servers/s1") return {
          id: "s1", name: "ERP", endpoint: "https://erp.example/mcp", description: "ERP tools",
          transport_type: "STREAMABLE_HTTP", timeout_seconds: 45,
          header_mappings: [{ header_name: "X-Key", credential_id: "cred-1", credential_key: "token", value_prefix: "Bearer " }],
        };
        if (path === "/api/mcp-tools/servers/s1/credential-profiles") return { items: [{ profile_name: "production" }] };
        if (path.startsWith("/api/mcp-tools/servers?q=")) return { items: conflict ? [{ name: "ERP", endpoint: "https://erp.example/mcp" }] : [] };
        if (path === "/api/mcp-tools/servers" && method === "POST") return { id: "s2" };
        if (path === "/api/mcp-tools/servers/s2") return { id: "s2" };
        throw new Error(`unexpected ${method} ${path}`);
      },
    },
  } as unknown as Runtime;
}

test("MCP server copy strips credential IDs and does not refresh tools", async () => {
  const calls: Array<{ method: string; path: string; body?: unknown }> = [];
  const source = runtime("prod", calls);
  const destination = runtime("stage", calls);
  const preview = await copyMcpServer({ source, destination, serverId: "s1", dryRun: true });
  assert.equal(preview.conflict, false);
  assert.deepEqual(preview.credential_profiles_required, ["production"]);
  assert.equal(calls.some((call) => call.method === "POST"), false);
  const copied = await copyMcpServer({ source, destination, serverId: "s1", dryRun: false, confirm: true });
  assert.equal(copied.created.id, "s2");
  const create = calls.find((call) => call.method === "POST");
  assert.ok(create);
  assert.doesNotMatch(JSON.stringify(create.body), /cred-1/);
  assert.match(JSON.stringify(create.body), /Bearer/);
  assert.equal(calls.some((call) => call.path.endsWith("/refresh")), false);
  assert.equal(copied.created.refresh_required, true);
});

test("MCP server copy refuses destination conflicts", async () => {
  const calls: Array<{ method: string; path: string; body?: unknown }> = [];
  await assert.rejects(() => copyMcpServer({
    source: runtime("prod", calls),
    destination: runtime("stage", calls, true),
    serverId: "s1",
    dryRun: false,
    confirm: true,
  }), /already exists/);
  assert.equal(calls.some((call) => call.method === "POST"), false);
});
