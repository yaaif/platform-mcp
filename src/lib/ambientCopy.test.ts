import assert from "node:assert/strict";
import test from "node:test";
import type { Runtime } from "../runtime.js";
import { copyAmbientWorkflow } from "./ambientCopy.js";

function runtime(profile: string, calls: Array<{ method: string; path: string; body?: unknown }>, conflict = false): Runtime {
  return {
    cfg: { activeProfileId: profile },
    api: {
      agentJSON: async (method: string, path: string, body?: unknown) => {
        calls.push({ method, path, body });
        if (path === "/api/ambient/workflows/wf-1") return {
          id: "wf-1",
          ambient_agent_id: "aa-1",
          name: "Nightly sync",
          description: "Sync records",
          enabled: true,
          workflow_async_enabled: true,
          requires_approval: true,
          workflow_graph: {
            nodes: [
              { id: "safe", type: "tool_call", credential_id: "cred-1", approval_strategy_id: "approval-1", input: { url: "https://safe.example" } },
              { id: "secret", type: "action", token: "do-not-copy" },
            ],
          },
          policy: { allowed_child_workflow_ids: ["wf-child"], allowed_webhook_host_suffixes: [".example.com"] },
          trigger_rules: [{ event_type: "file.ready", agent_id: "chat-1", spec_id: "spec-1" }],
        };
        if (path === "/api/ambient/agents/aa-1") return { id: "aa-1", name: "Ambient" };
        if (path.startsWith("/api/ambient/agents?q=")) return { items: [{ id: "aa-stage", name: "Ambient" }] };
        if (path.startsWith("/api/ambient/workflows?ambient_agent_id=")) return { items: conflict ? [{ name: "Nightly sync" }] : [] };
        if (path === "/api/ambient/agents/aa-stage/workflows" && method === "POST") return { id: "wf-stage" };
        if (path === "/api/ambient/workflows/wf-stage") return { id: "wf-stage", enabled: false };
        throw new Error(`unexpected ${method} ${path}`);
      },
    },
  } as unknown as Runtime;
}

test("ambient copy sanitizes server IDs and creates a disabled workflow", async () => {
  const calls: Array<{ method: string; path: string; body?: unknown }> = [];
  const source = runtime("prod", calls);
  const destination = runtime("stage", calls);
  const preview = await copyAmbientWorkflow({ source, destination, workflowId: "wf-1", dryRun: true });
  assert.equal(preview.conflict, false);
  assert.ok(preview.dependencies.includes("credential_id"));
  assert.ok(preview.dependencies.includes("approval_strategy_id"));
  assert.equal(calls.some((call) => call.method === "POST"), false);
  const copied = await copyAmbientWorkflow({ source, destination, workflowId: "wf-1", dryRun: false, confirm: true });
  assert.equal(copied.created.id, "wf-stage");
  const create = calls.find((call) => call.method === "POST");
  const body = create?.body as { enabled: boolean; workflow_async_enabled: boolean; requires_approval: boolean };
  assert.equal(body.enabled, false);
  assert.equal(body.workflow_async_enabled, false);
  assert.equal(body.requires_approval, false);
  assert.doesNotMatch(JSON.stringify(body), /cred-1|approval-1|do-not-copy|wf-child|chat-1|spec-1/);
  assert.match(JSON.stringify(body), /example.com/);
});

test("ambient copy refuses conflicts", async () => {
  const calls: Array<{ method: string; path: string; body?: unknown }> = [];
  await assert.rejects(() => copyAmbientWorkflow({
    source: runtime("prod", calls),
    destination: runtime("stage", calls, true),
    workflowId: "wf-1",
    dryRun: false,
    confirm: true,
  }), /already exists/);
  assert.equal(calls.some((call) => call.method === "POST"), false);
});
