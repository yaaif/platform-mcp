import assert from "node:assert/strict";
import test from "node:test";
import type { Runtime } from "../runtime.js";
import { copyCatalog } from "./catalogCopy.js";

function runtime(profile: string, calls: Array<{ method: string; path: string; body?: unknown }>, conflict = false): Runtime {
  return {
    cfg: { activeProfileId: profile, client: { updatedBy: "test" } },
    api: {
      agentJSON: async (method: string, path: string, body?: unknown) => {
        calls.push({ method, path, body });
        if (path.includes("/revisions/") && path.endsWith("/export")) return { manifest_hash: "hash", snapshot: { slug: "spec", name: "Spec", segments: [], requirements: [], slots: [] } };
        if (path === "/api/agent-specs/spec") return { current_revision: 1 };
        if (path === "/api/agent-specs?q=spec&limit=200") return { items: [] };
        if (path === "/api/agent-specs" && method === "POST") return { id: "spec-new" };
        if (path === "/api/agent-specs/spec-new") return { id: "spec-new" };
        if (path === "/api/mcp-tools/servers/s1") return { id: "s1", name: "ERP", endpoint: "https://erp.example/mcp", header_mappings: [] };
        if (path === "/api/mcp-tools/servers/s1/credential-profiles") return { items: [] };
        if (path.startsWith("/api/mcp-tools/servers?q=")) return { items: [] };
        if (path === "/api/mcp-tools/servers" && method === "POST") return { id: "s2" };
        if (path === "/api/mcp-tools/servers/s2") return { id: "s2" };
        if (path === "/api/skills?ids=skill&limit=1") return { items: profile === "prod" ? [{ id: "skill", description: "Skill", instruction: "Use" }] : (conflict ? [{ id: "skill" }] : []) };
        if (path === "/api/skill-files/tree?path=skill") return { root: { path: "skill/SKILL.md", kind: "file" } };
        if (path.includes("skill%2FSKILL.md")) return { content: "---\nname: skill\n---\nUse" };
        if (path === "/api/skills?ids=skill&limit=1") return { items: conflict ? [{ id: "skill" }] : [] };
        if (path === "/api/skills" && method === "POST") return { id: "skill" };
        if (path === "/api/skill-files/content" && method === "PUT") return { ok: true };
        if (path === "/api/agents/a1") return { id: "a1", name: "Workflow Agent", goal_prompt: "Run", agent_type: "workflow", skill_ids: [] };
        if (path.startsWith("/api/agents?q=")) return { items: conflict ? [{ id: "a-stage", name: "Workflow Agent" }] : [] };
        if (path === "/api/agents" && method === "POST") return { id: "a-stage" };
        if (path === "/api/agents/a-stage") return { id: "a-stage" };
        if (path === "/api/ambient/agents/aa-1") return { id: "aa-1", agent_id: "a1", name: "Ambient" };
        if (path.startsWith("/api/ambient/agents?q=")) return { items: conflict ? [{ id: "aa-stage", name: "Ambient" }] : [] };
        if (path === "/api/ambient/agents" && method === "POST") return { id: "aa-stage" };
        if (path === "/api/ambient/agents/aa-stage") return { id: "aa-stage" };
        if (path === "/api/ambient/workflows/wf-1") return { id: "wf-1", ambient_agent_id: "aa-1", name: "Nightly", workflow_graph: {}, policy: {}, trigger_rules: [] };
        if (path.startsWith("/api/ambient/workflows?ambient_agent_id=")) return { items: [] };
        if (path === "/api/ambient/agents/aa-stage/workflows" && method === "POST") return { id: "wf-stage" };
        if (path === "/api/ambient/workflows/wf-stage") return { id: "wf-stage" };
        throw new Error(`unexpected ${method} ${path}`);
      },
    },
  } as unknown as Runtime;
}

test("catalog copy applies resources in dependency order", async () => {
  const calls: Array<{ method: string; path: string; body?: unknown }> = [];
  const source = runtime("prod", calls);
  const destination = runtime("stage", calls);
  const preview = await copyCatalog({ source, destination, mcpServers: ["s1"], skills: ["skill"], agents: ["a1"], ambientAgents: ["aa-1"], workflows: ["wf-1"], scenarios: ["spec"], workflowAgentId: "a-stage", ambientAgentId: "aa-stage", dryRun: true });
  assert.equal(preview.conflicts.length, 0);
  assert.ok(!calls.some((call) => call.method === "POST" || call.method === "PUT"), JSON.stringify(calls));
  const copied = await copyCatalog({ source, destination, mcpServers: ["s1"], skills: ["skill"], agents: ["a1"], ambientAgents: ["aa-1"], workflows: ["wf-1"], scenarios: ["spec"], workflowAgentId: "a-stage", ambientAgentId: "aa-stage", dryRun: false, confirm: true });
  assert.deepEqual(copied.applied.map((item) => item.kind), ["mcp-server", "skill", "agent", "ambient-agent", "workflow", "scenario"]);
  assert.equal(calls.filter((call) => call.method === "POST").length, 6);
});

test("catalog copy aborts on conflict before any writes", async () => {
  const calls: Array<{ method: string; path: string; body?: unknown }> = [];
  const source = runtime("prod", calls);
  const destination = runtime("stage", calls, true);
  await assert.rejects(() => copyCatalog({ source, destination, skills: ["skill"], dryRun: false, confirm: true }), /conflicts/);
  assert.equal(calls.some((call) => call.method === "POST" || call.method === "PUT"), false);
});
