import assert from "node:assert/strict";
import test from "node:test";
import { buildFileWorkflows, validateFileWorkflowOptions } from "./fileWorkflow.js";

test("defaults build ready + failed workflows that reply to the origin with the event summary", () => {
  const [ready, failed] = buildFileWorkflows({});
  assert.equal(ready.name, "File intake: ready");
  assert.equal(failed.name, "File intake: failed");
  const rule = (ready.trigger_rules as Array<Record<string, unknown>>)[0];
  assert.equal(rule.source_type, "file");
  assert.deepEqual(rule.event_types, ["file.ready"]);
  assert.deepEqual(rule.entity_types, ["file"]);
  assert.equal(rule.filter_contains, undefined);
  const nodes = (ready.workflow_graph as { nodes: Array<{ id: string; type: string; config: Record<string, unknown> }> }).nodes;
  assert.deepEqual(nodes.map((n) => n.id), ["reply-to-origin", "done"]);
  const reply = nodes[0];
  assert.equal(reply.type, "file_artifact");
  assert.equal(reply.config.operation, "reply_origin");
  assert.equal(reply.config.file_id_binding, "signal.payload.file_id");
  assert.deepEqual(reply.config.query_bindings, [{ from: "signal.payload.summary", to: "message", required: true }]);
});

test("custom steps chain in order before the reply, for file.ready only", () => {
  const [ready, failed] = buildFileWorkflows({
    events: ["file.ready", "file.failed"],
    load_content: true,
    load_tables: true,
    steps: [{ tool_name: "my_erp_post_prices", input: { file_id: "signal.payload.file_id", content: "context.file_content" } }],
    message_binding: "context.my_erp_post_prices_result",
  });
  const graph = ready.workflow_graph as { nodes: Array<{ id: string; type: string; config: Record<string, any> }>; edges: Array<{ from: string; to: string }> };
  assert.deepEqual(graph.nodes.map((n) => n.id), ["load-content", "load-tables", "step-1-my-erp-post-prices", "reply-to-origin", "done"]);
  assert.equal(graph.nodes[0].config.tool_name, "file_load_context");
  assert.equal(graph.nodes[0].config.output_key, "context.file_content");
  assert.equal(graph.nodes[1].config.tool_name, "file_tables");
  const custom = graph.nodes[2].config;
  assert.deepEqual(JSON.parse(custom.input_bindings as string), [
    { from: "signal.payload.file_id", to: "file_id" },
    { from: "context.file_content", to: "content" },
  ]);
  assert.equal(custom.output_key, "context.my_erp_post_prices_result");
  assert.deepEqual(graph.edges.map((e) => `${e.from}>${e.to}`), [
    "load-content>load-tables", "load-tables>step-1-my-erp-post-prices", "step-1-my-erp-post-prices>reply-to-origin", "reply-to-origin>done",
  ]);
  const replyBinding = graph.nodes[3].config.query_bindings[0];
  assert.equal(replyBinding.from, "context.my_erp_post_prices_result");
  // the failed workflow has no processing steps: it just relays the failure summary
  const failedNodes = (failed.workflow_graph as { nodes: Array<{ id: string }> }).nodes;
  assert.deepEqual(failedNodes.map((n) => n.id), ["reply-to-origin", "done"]);
});

test("agent_id scopes the rule through filter_contains; both together are rejected", () => {
  const [ready] = buildFileWorkflows({ events: ["file.ready"], agent_id: "agent-123" });
  assert.equal(((ready.trigger_rules as Array<Record<string, unknown>>)[0]).filter_contains, "agent-123");
  assert.throws(() => buildFileWorkflows({ agent_id: "a", filter_contains: "b" }), /either agent_id or filter_contains/);
});

test("validation rejects unknown events, empty tool names and no-op workflows", () => {
  assert.ok(validateFileWorkflowOptions({ events: ["file.exploded" as never] })[0].includes("unknown event"));
  assert.ok(validateFileWorkflowOptions({ steps: [{ tool_name: " " }] }).some((p) => p.includes("tool_name is required")));
  assert.ok(validateFileWorkflowOptions({ reply: false }).some((p) => p.includes("nothing to do")));
  assert.deepEqual(validateFileWorkflowOptions({ reply: false, load_content: true }), []);
});

test("review_decided workflow and duplicate events are handled", () => {
  const built = buildFileWorkflows({ events: ["file.review_decided", "file.review_decided"] });
  assert.equal(built.length, 1);
  assert.equal(built[0].name, "File intake: review decided");
});
