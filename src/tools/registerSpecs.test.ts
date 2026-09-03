import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Ctx } from "./ctx.js";
import { registerSpecTools } from "./registerSpecs.js";

type RegisteredTool = {
  description?: string;
  inputSchema: Record<string, z.ZodType>;
  handler: (args: Record<string, unknown>) => Promise<unknown>;
};

function registeredTools() {
  const tools = new Map<string, RegisteredTool>();
  const server = {
    registerTool(
      name: string,
      definition: { description?: string; inputSchema: Record<string, z.ZodType> },
      handler: RegisteredTool["handler"],
    ) {
      tools.set(name, { description: definition.description, inputSchema: definition.inputSchema, handler });
    },
  } as unknown as McpServer;
  return { server, tools };
}

test("Scenario MCP tools validate versioned payloads and preserve evidence provenance", async () => {
  const calls: Array<{ method: string; path: string; body?: unknown }> = [];
  const { server, tools } = registeredTools();
  const ctx = {
    api: {
      agentJSON: async (method: string, path: string, body?: unknown) => {
        calls.push({ method, path, body });
        return { ok: true };
      },
    },
  } as unknown as Ctx;
  registerSpecTools(server, ctx);

  const sync = tools.get("yaaif_agent_spec_sync_apply");
  const evidence = tools.get("yaaif_agent_spec_evidence_record");
  const policyImport = tools.get("yaaif_agent_spec_policy_import");
  const publish = tools.get("yaaif_agent_spec_publish");
  const provenance = tools.get("yaaif_agent_spec_release_provenance_record");
  const promote = tools.get("yaaif_agent_spec_release_candidate_promote");
  const backfill = tools.get("yaaif_agent_spec_legacy_revision_backfill_apply");
  assert.ok(sync && evidence && policyImport && publish && provenance && promote && backfill);

  const syncSchema = z.object(sync.inputSchema);
  assert.equal(syncSchema.safeParse({ spec_id: "spec-1", expected_version: 0, direction: "from_objects", preview_id: "not-a-uuid" }).success, false);
  await sync.handler({
    spec_id: "spec-1",
    expected_version: 4,
    direction: "to_objects",
    preview_id: "5b35c19b-5f21-4d3f-9fb4-af0403c0d356",
  });
  assert.deepEqual(calls.at(-1), {
    method: "POST",
    path: "/api/agent-specs/spec-1/sync-apply",
    body: {
      expected_version: 4,
      direction: "to_objects",
      preview_id: "5b35c19b-5f21-4d3f-9fb4-af0403c0d356",
    },
  });

  const publishSchema = z.object(publish.inputSchema);
  assert.equal(publishSchema.safeParse({ spec_id: "spec-1", expected_version: 4, release_kind: "breaking" }).success, false);
  await publish.handler({ spec_id: "spec-1", expected_version: 4, release_kind: "minor", change_summary: "Add compatible routing" });
  assert.deepEqual(calls.at(-1), {
    method: "POST",
    path: "/api/agent-specs/spec-1/revisions",
    body: { expected_version: 4, release_kind: "minor", release_channel: "stable", change_summary: "Add compatible routing" },
  });

  const evidenceSchema = z.object(evidence.inputSchema);
  assert.equal(evidenceSchema.safeParse({ spec_id: "spec-1", expected_version: 4, requirement_key: "REQ-1", kind: "manual_attestation", result: "passed", provenance_uri: "not a uri" }).success, false);
  await evidence.handler({
    spec_id: "spec-1",
    expected_version: 4,
    requirement_key: "REQ-1",
    kind: "manual_attestation",
    result: "passed",
    provenance_uri: "manual-attestation://reviewer-1",
    idempotency_key: "evidence-retry-key",
  });
  assert.deepEqual(calls.at(-1), {
    method: "POST",
    path: "/api/agent-specs/spec-1/evidence",
    body: {
      spec_id: "spec-1",
      expected_version: 4,
      requirement_key: "REQ-1",
      kind: "manual_attestation",
      result: "passed",
      provenance_uri: "manual-attestation://reviewer-1",
      idempotency_key: "evidence-retry-key",
    },
  });

  const policySchema = z.object(policyImport.inputSchema);
  assert.equal(policySchema.safeParse({ document: { version: 1, mode: "require", evidence_ttl_days: -1, require_second_approver: true } }).success, false);

  const provenanceSchema = z.object(provenance.inputSchema);
  assert.equal(provenanceSchema.safeParse({ spec_id: "spec-1", expected_version: 4, revision: 2, kind: "verification", result: "passed", report_uri: "not-a-url" }).success, false);
  await provenance.handler({
    spec_id: "spec-1",
    expected_version: 4,
    revision: 2,
    kind: "verification",
    result: "passed",
    commit_sha: "abc123",
    report_uri: "https://ci.example.test/reports/2",
  });
  assert.deepEqual(calls.at(-1), {
    method: "POST",
    path: "/api/agent-specs/spec-1/revisions/provenance",
    body: {
      expected_version: 4,
      revision: 2,
      kind: "verification",
      result: "passed",
      commit_sha: "abc123",
      report_uri: "https://ci.example.test/reports/2",
    },
  });

  const promoteSchema = z.object(promote.inputSchema);
  assert.equal(promoteSchema.safeParse({ spec_id: "spec-1", revision: 0, expected_version: 4 }).success, false);
  await promote.handler({ spec_id: "spec-1", revision: 2, expected_version: 4 });
  assert.deepEqual(calls.at(-1), {
    method: "POST",
    path: "/api/agent-specs/spec-1/revisions/2/promote",
    body: { expected_version: 4, change_summary: "" },
  });

  const backfillSchema = z.object(backfill.inputSchema);
  assert.equal(backfillSchema.safeParse({ spec_id: "spec-1", expected_version: 4, preview_hash: "short" }).success, false);
});

test("Scenario sync tools describe apply versus adopt", () => {
  const { server, tools } = registeredTools();
  registerSpecTools(server, { api: { agentJSON: async () => ({}) } } as unknown as Ctx);

  const apply = tools.get("yaaif_agent_spec_sync_to_objects");
  const adopt = tools.get("yaaif_agent_spec_sync_from_objects");
  const preview = tools.get("yaaif_agent_spec_sync_preview");
  assert.ok(apply && adopt && preview);
  assert.match(String(apply.description), /Apply Scenario-owned names/);
  assert.match(String(adopt.description), /Adopt live catalog objects/);
  assert.match(String(preview.description), /to_objects: spec → catalog/);
});
