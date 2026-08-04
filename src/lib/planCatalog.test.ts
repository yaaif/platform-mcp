import assert from "node:assert/strict";
import { test } from "node:test";
import { extractCatalogBuckets, verifyPlanAgainstCatalog } from "./planCatalog.js";

test("verifyPlanAgainstCatalog reports missing and found", () => {
  const buckets = extractCatalogBuckets({
    agents: { items: [{ id: "1", name: "Chat Agent" }] },
    skills: { items: [{ id: "domain/triage", name: "triage" }] },
    ambient_workflows: { items: [{ id: "w1", name: "invoice-clearance" }] },
    mcp_tools: { items: [{ name: "get_invoice" }] },
    ambient_agents: { items: [{ name: "Invoice Ambient" }] },
    local_tools: { names: ["list_ambient_workflows", "files_list"] },
  });
  const result = verifyPlanAgainstCatalog(
    {
      agent_names: ["Chat Agent", "Missing Agent"],
      skill_ids: ["domain/triage"],
      workflow_names: ["invoice-clearance"],
      mcp_tool_names: ["get_invoice"],
      ambient_agent_names: ["Invoice Ambient"],
      local_tool_names: ["list_ambient_workflows", "not_a_local"],
    },
    buckets,
  );
  assert.equal(result.ok, false);
  assert.deepEqual(result.missing.agent_names, ["Missing Agent"]);
  assert.deepEqual(result.found.skill_ids, ["domain/triage"]);
  assert.deepEqual(result.found.local_tool_names, ["list_ambient_workflows"]);
  assert.deepEqual(result.missing.local_tool_names, ["not_a_local"]);
});
