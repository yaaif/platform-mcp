import assert from "node:assert/strict";
import test from "node:test";
import type { Runtime } from "../runtime.js";
import { copyAgent } from "./agentCopy.js";

function runtime(profile: string, calls: Array<{ method: string; path: string; body?: unknown }>, conflict = false): Runtime {
  return {
    cfg: { activeProfileId: profile },
    api: {
      agentJSON: async (method: string, path: string, body?: unknown) => {
        calls.push({ method, path, body });
        if (path === "/api/agents/a1") return { id: "a1", name: "Support", description: "Support agent", goal_prompt: "Help users", agent_type: "workflow", skill_ids: ["skill-1"], enabled: true };
        if (path.startsWith("/api/agents?q=")) return { items: conflict ? [{ name: "Support" }] : [] };
        if (path === "/api/agents" && method === "POST") return { id: "a2" };
        if (path === "/api/agents/a2") return { id: "a2", enabled: false };
        throw new Error(`unexpected ${method} ${path}`);
      },
    },
  } as unknown as Runtime;
}

test("agent copy preserves definition but disables it and drops mappings", async () => {
  const calls: Array<{ method: string; path: string; body?: unknown }> = [];
  const source = runtime("prod", calls);
  const destination = runtime("stage", calls);
  const preview = await copyAgent({ source, destination, agentId: "a1", dryRun: true });
  assert.equal(preview.conflict, false);
  assert.deepEqual(preview.required_skill_ids, ["skill-1"]);
  assert.equal(calls.some((call) => call.method === "POST"), false);
  const copied = await copyAgent({ source, destination, agentId: "a1", dryRun: false, confirm: true });
  assert.equal(copied.created.id, "a2");
  const create = calls.find((call) => call.method === "POST");
  const body = create?.body as { enabled: boolean; skill_ids: string[]; agent_type: string };
  assert.equal(body.enabled, false);
  assert.equal(body.agent_type, "workflow");
  assert.deepEqual(body.skill_ids, []);
  assert.doesNotMatch(JSON.stringify(body), /spec_id|slot_key/);
});

test("agent copy refuses destination conflicts", async () => {
  const calls: Array<{ method: string; path: string; body?: unknown }> = [];
  await assert.rejects(() => copyAgent({
    source: runtime("prod", calls),
    destination: runtime("stage", calls, true),
    agentId: "a1",
    dryRun: false,
    confirm: true,
  }), /already exists/);
  assert.equal(calls.some((call) => call.method === "POST"), false);
});
