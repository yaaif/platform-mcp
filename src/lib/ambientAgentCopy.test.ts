import assert from "node:assert/strict";
import test from "node:test";
import type { Runtime } from "../runtime.js";
import { copyAmbientAgent } from "./ambientAgentCopy.js";

function runtime(profile: string, calls: Array<{ method: string; path: string; body?: unknown }>, conflict = false): Runtime {
  return {
    cfg: { activeProfileId: profile },
    api: {
      agentJSON: async (method: string, path: string, body?: unknown) => {
        calls.push({ method, path, body });
        if (path === "/api/ambient/agents/aa-1") return { id: "aa-1", agent_id: "a1", name: "Ambient", description: "Ambient agent", mode: "active", enabled: true, workflow_async_enabled: true, requires_approval: true, policy: { credential_id: "cred-1", allowed_webhook_host_suffixes: [".example.com"] } };
        if (path === "/api/agents/a1") return { id: "a1", name: "Workflow Agent" };
        if (path.startsWith("/api/agents?q=")) return { items: [{ id: "a-stage", name: "Workflow Agent" }] };
        if (path.startsWith("/api/ambient/agents?q=")) return { items: conflict ? [{ name: "Ambient" }] : [] };
        if (path === "/api/ambient/agents" && method === "POST") return { id: "aa-stage" };
        if (path === "/api/ambient/agents/aa-stage") return { id: "aa-stage", enabled: false };
        throw new Error(`unexpected ${method} ${path}`);
      },
    },
  } as unknown as Runtime;
}

test("ambient agent copy links destination workflow agent and disables config", async () => {
  const calls: Array<{ method: string; path: string; body?: unknown }> = [];
  const source = runtime("prod", calls);
  const destination = runtime("stage", calls);
  const preview = await copyAmbientAgent({ source, destination, ambientAgentId: "aa-1", dryRun: true });
  assert.equal(preview.conflict, false);
  assert.equal(preview.workflow_agent_id, "a-stage");
  assert.equal(calls.some((call) => call.method === "POST"), false);
  const copied = await copyAmbientAgent({ source, destination, ambientAgentId: "aa-1", dryRun: false, confirm: true });
  assert.equal(copied.created.id, "aa-stage");
  const create = calls.find((call) => call.method === "POST");
  const body = create?.body as { agent_id: string; enabled: boolean; workflow_async_enabled: boolean; requires_approval: boolean };
  assert.equal(body.agent_id, "a-stage");
  assert.equal(body.enabled, false);
  assert.equal(body.workflow_async_enabled, false);
  assert.equal(body.requires_approval, false);
  assert.doesNotMatch(JSON.stringify(body), /cred-1/);
  assert.match(JSON.stringify(body), /example.com/);
});

test("ambient agent copy refuses destination conflicts", async () => {
  const calls: Array<{ method: string; path: string; body?: unknown }> = [];
  await assert.rejects(() => copyAmbientAgent({
    source: runtime("prod", calls),
    destination: runtime("stage", calls, true),
    ambientAgentId: "aa-1",
    dryRun: false,
    confirm: true,
  }), /already exists/);
  assert.equal(calls.some((call) => call.method === "POST"), false);
});
