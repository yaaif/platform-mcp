import assert from "node:assert/strict";
import test from "node:test";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Ctx } from "./ctx.js";
import { OPENCODE_TOOL_ALLOWLIST_SET } from "./opencodeAllowlist.js";
import { registerFileWorkflowTools } from "./registerFileWorkflows.js";

type Handler = (args: Record<string, unknown>) => Promise<{ isError?: boolean; structuredContent?: Record<string, any> }>;

function setup(post: (path: string, body: Record<string, unknown>) => Promise<unknown>) {
  const handlers = new Map<string, Handler>();
  const server = {
    registerTool(name: string, _def: unknown, handler: Handler) {
      handlers.set(name, handler);
    },
  } as unknown as McpServer;
  const calls: Array<{ method: string; path: string; body: Record<string, unknown> }> = [];
  const ctx = {
    api: {
      agentJSON: async (method: string, path: string, body: Record<string, unknown>) => {
        calls.push({ method, path, body });
        return post(path, body);
      },
    },
  } as unknown as Ctx;
  registerFileWorkflowTools(server, ctx);
  return { handlers, calls };
}

test("both tools are registered and exposed to OpenCode", () => {
  const { handlers } = setup(async () => ({}));
  assert.deepEqual([...handlers.keys()].sort(), ["yaaif_file_workflow_create", "yaaif_file_workflow_template"]);
  for (const name of handlers.keys()) assert.ok(OPENCODE_TOOL_ALLOWLIST_SET.has(name), `${name} missing from the OpenCode allowlist`);
});

test("template builds workflows and the event reference without calling the API", async () => {
  const { handlers, calls } = setup(async () => ({}));
  const result = await handlers.get("yaaif_file_workflow_template")!({ load_content: true, agent_id: "agent-9" });
  assert.ok(!result.isError);
  assert.equal(calls.length, 0);
  assert.equal(result.structuredContent!.workflows.length, 2);
  assert.ok(result.structuredContent!.payload_fields.includes("signal.payload.file_id"));
  assert.equal(result.structuredContent!.workflows[0].trigger_rules[0].filter_contains, "agent-9");
});

test("create posts one workflow per event under the ambient agent; dry_run posts nothing", async () => {
  const { handlers, calls } = setup(async (_path, body) => ({ id: `wf-${String(body.name).length}`, name: body.name }));
  const dry = await handlers.get("yaaif_file_workflow_create")!({ ambient_agent_id: "amb 1", dry_run: true });
  assert.equal(calls.length, 0);
  assert.equal(dry.structuredContent!.dry_run, true);

  const real = await handlers.get("yaaif_file_workflow_create")!({ ambient_agent_id: "amb 1", events: ["file.ready"] });
  assert.ok(!real.isError);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, "POST");
  assert.equal(calls[0].path, "/api/ambient/agents/amb%201/workflows");
  assert.equal((calls[0].body.trigger_rules as Array<Record<string, unknown>>)[0].source_type, "file");
  assert.equal(real.structuredContent!.created.length, 1);
});

test("create reports partial failures and bad input", async () => {
  let n = 0;
  const { handlers } = setup(async () => {
    if (++n === 2) throw new Error("409 name exists");
    return { id: "wf" };
  });
  const partial = await handlers.get("yaaif_file_workflow_create")!({ ambient_agent_id: "a" });
  assert.ok(!partial.isError);
  assert.equal(partial.structuredContent!.created.length, 1);
  assert.match(partial.structuredContent!.failed[0].error, /409/);

  const none = await handlers.get("yaaif_file_workflow_create")!({ ambient_agent_id: "a", events: ["file.ready"], agent_id: "x", filter_contains: "y" });
  assert.ok(none.isError);
  assert.match(String(none.structuredContent!.error), /either agent_id or filter_contains/);
  assert.ok((await handlers.get("yaaif_file_workflow_create")!({ ambient_agent_id: " " })).isError);
});
