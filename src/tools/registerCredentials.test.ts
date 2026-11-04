import assert from "node:assert/strict";
import test from "node:test";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Ctx } from "./ctx.js";
import { injectAcrossTools, registerCredentialTools } from "./registerCredentials.js";

type RegisteredTool = {
  handler: (args: Record<string, unknown>) => Promise<{ isError?: boolean; content?: Array<{ text?: string }>; structuredContent?: Record<string, unknown> }>;
};

function capture(ctx: Ctx): Map<string, RegisteredTool> {
  const tools = new Map<string, RegisteredTool>();
  const server = {
    registerTool(name: string, _definition: unknown, handler: RegisteredTool["handler"]) {
      tools.set(name, { handler });
    },
  } as unknown as McpServer;
  registerCredentialTools(server, ctx);
  return tools;
}

test("injectAcrossTools maps only the arguments each tool declares", () => {
  const inject = injectAcrossTools(
    [
      { name: "srv.a", input_schema: { properties: { sap_username: {}, sap_password: {} } } },
      { name: "srv.b", input_schema: JSON.stringify({ properties: { sap_username: {} } }) },
      { name: "srv.c", input_schema: { properties: { other: {} } } },
    ],
    { sap_username: "username", sap_password: "password" },
  );
  assert.deepEqual(inject, {
    "srv.a": { sap_username: "username", sap_password: "password" },
    "srv.b": { sap_username: "username" },
  });
});

test("yaaif_credential_create sends an idempotency key and never echoes values", async () => {
  let sentHeaders: Record<string, string> | undefined;
  const tools = capture({
    api: {
      apiJSON: async (method: string, path: string, body?: unknown, opts?: { headers?: Record<string, string> }) => {
        assert.equal(`${method} ${path}`, "POST /api/credentials");
        assert.equal((body as { scope?: string }).scope, "tenant_wide");
        sentHeaders = opts?.headers;
        return { id: "c1", kind: "sap", display_name: "X00", key_names: ["password", "username"], values: { password: "secret" } };
      },
    },
  } as unknown as Ctx);

  const result = await tools.get("yaaif_credential_create")!.handler({
    kind: "sap", display_name: "X00", values: { username: "u", password: "secret" },
  });
  assert.equal(result.isError, undefined);
  assert.match(sentHeaders?.["Idempotency-Key"] ?? "", /^mcp-credential-create:/);
  assert.doesNotMatch(JSON.stringify(result), /secret/);
});

test("yaaif_mcp_server_create sends header mappings instead of header values", async () => {
  let sent: any;
  const tools = capture({
    api: {
      agentJSON: async (method: string, path: string, body?: unknown) => {
        assert.equal(`${method} ${path}`, "POST /api/mcp-tools/servers");
        sent = body;
        return { id: "s1", name: "srv", endpoint: "http://127.0.0.1:8011/sse", transport_type: "SSE", headers: { "X-Key": "secret" } };
      },
    },
  } as unknown as Ctx);

  const result = await tools.get("yaaif_mcp_server_create")!.handler({
    name: "srv",
    endpoint: "http://127.0.0.1:8011/sse",
    transport_type: "SSE",
    header_mappings: [{ header_name: "X-Key", credential_id: "c1", credential_key: "token" }],
  });
  assert.equal(result.isError, undefined);
  assert.deepEqual(sent.header_mappings, [{ header_name: "X-Key", credential_id: "c1", credential_key: "token" }]);
  assert.equal(sent.headers, undefined);
  assert.doesNotMatch(JSON.stringify(result), /secret/);
});

test("yaaif_mcp_credential_profile_upsert creates with If-Match 0 and injects across tools", async () => {
  let put: { body?: any; headers?: Record<string, string> } = {};
  const tools = capture({
    api: {
      agentJSON: async (method: string, path: string, body?: unknown, opts?: { headers?: Record<string, string> }) => {
        if (method === "GET" && path === "/api/mcp-tools/servers/s1/credential-profiles") return { items: [] };
        if (method === "GET" && path === "/api/mcp-tools/servers/s1") {
          return { tools: [{ name: "srv.a", input_schema: { properties: { sap_username: {}, sap_password: {} } } }] };
        }
        if (method === "PUT" && path === "/api/mcp-tools/servers/s1/credential-profiles/x00") {
          put = { body, headers: opts?.headers };
          return { profile_name: "x00", revision: 1 };
        }
        throw new Error(`unexpected ${method} ${path}`);
      },
    },
  } as unknown as Ctx);

  const result = await tools.get("yaaif_mcp_credential_profile_upsert")!.handler({
    server_id: "s1",
    profile_name: "x00",
    credential_bindings: [{ binding_name: "sap", credential_kind: "sap", field_map: { username: "username", password: "password" } }],
    inject_all_tools: { binding: "sap", args: { sap_username: "username", sap_password: "password" } },
    is_default: true,
  });
  assert.equal(result.isError, undefined);
  assert.equal(put.headers?.["If-Match"], "0");
  assert.deepEqual(put.body.arg_injection, {
    version: 1,
    bindings: [{ binding: "sap", inject: { "srv.a": { sap_username: "username", sap_password: "password" } } }],
  });
});
