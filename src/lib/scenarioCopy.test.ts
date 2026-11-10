import assert from "node:assert/strict";
import test from "node:test";
import type { Runtime } from "../runtime.js";
import { copyScenario } from "./scenarioCopy.js";

function runtime(profile: string, calls: Array<{ method: string; path: string; body?: unknown }>, conflict = false): Runtime {
  return {
    cfg: { activeProfileId: profile },
    api: {
      agentJSON: async (method: string, path: string, body?: unknown) => {
        calls.push({ method, path, body });
        if (path === "/api/agent-specs/source") return { current_revision: 3 };
        if (path === "/api/agent-specs/source/revisions/3/export") return {
          manifest_hash: "abc123",
          snapshot: {
            id: "source-id",
            tenant_id: "source-tenant",
            slug: "source-scenario",
            name: "Source Scenario",
            description: "Portable draft",
            segments: [{ segment_key: "identity", title: "Identity", body_md: "Safe", id: "segment-id" }],
            requirements: [{ req_key: "REQ-1", title: "Requirement", priority: "must" }],
            slots: [{ slot_key: "main", kind: "agent", expected_name: "Agent", entity_id: "bound-id" }],
          },
        };
        if (path.startsWith("/api/agent-specs?q=")) return { items: conflict ? [{ slug: "source-scenario" }] : [] };
        if (path === "/api/agent-specs" && method === "POST") return { id: "destination-id", slug: "source-scenario" };
        if (path === "/api/agent-specs/destination-id") return { id: "destination-id", status: "draft" };
        throw new Error(`unexpected ${method} ${path}`);
      },
    },
  } as unknown as Runtime;
}

test("Scenario copy previews without writes then creates a draft without source identities", async () => {
  const calls: Array<{ method: string; path: string; body?: unknown }> = [];
  const source = runtime("prod", calls);
  const destination = runtime("stage", calls);
  const preview = await copyScenario({ source, destination, specId: "source", dryRun: true });
  assert.equal(preview.would_create, true);
  assert.equal(calls.some((call) => call.method === "POST"), false);
  const copied = await copyScenario({ source, destination, specId: "source", dryRun: false, confirm: true });
  const create = calls.find((call) => call.method === "POST" && call.path === "/api/agent-specs");
  assert.ok(create);
  const body = create.body as { status: string; segments: unknown[]; slots: unknown[] };
  assert.equal(body.status, "draft");
  assert.doesNotMatch(JSON.stringify(body), /source-tenant|source-id|bound-id|segment-id/);
  assert.equal(copied.created.id, "destination-id");
});

test("Scenario copy refuses destination conflicts", async () => {
  const calls: Array<{ method: string; path: string; body?: unknown }> = [];
  await assert.rejects(() => copyScenario({
    source: runtime("prod", calls),
    destination: runtime("stage", calls, true),
    specId: "source",
    dryRun: false,
    confirm: true,
  }), /already exists/);
  assert.equal(calls.some((call) => call.method === "POST"), false);
});
