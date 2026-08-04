import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { PlanExecutionStore } from "./planExecution.js";

test("plan execution resume skips done steps", async () => {
  const home = await mkdtemp(join(tmpdir(), "yaaif-plan-"));
  try {
    const store = new PlanExecutionStore(home);
    const saved = await store.save({
      slug: "demo",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      steps: [
        { id: "1", tool: "yaaif_agent_create", status: "done", result_ids: { agent_id: "a1" } },
        { id: "2", tool: "yaaif_skill_create", status: "failed", error: "boom" },
        { id: "3", tool: "yaaif_skill_map_agents_merge", status: "pending" },
      ],
    });
    const hint = store.resumeHint(saved);
    assert.equal(hint.complete, false);
    assert.equal(hint.next_step?.id, "2");
    assert.equal(hint.collected_ids.agent_id, "a1");
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
