import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Ctx } from "./ctx.js";
import { PlanExecutionStore } from "../lib/planExecution.js";
import { registerPlanTools } from "./registerPlan.js";

type RegisteredTool = { handler: (args: Record<string, unknown>) => Promise<{ isError?: boolean; structuredContent?: Record<string, unknown> }> };

test("plan resume refreshes Scenario version and halts for sync conflicts", async () => {
  const home = await mkdtemp(join(tmpdir(), "yaaif-plan-resume-"));
  try {
    const plans = new PlanExecutionStore(home);
    await plans.save({
      slug: "scenario-plan",
      spec_id: "spec-1",
      spec_version: 1,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      steps: [{ id: "create-agent", tool: "yaaif_agent_create", status: "pending" }],
    });
    const tools = new Map<string, RegisteredTool>();
    const server = {
      registerTool(name: string, _definition: unknown, handler: RegisteredTool["handler"]) {
        tools.set(name, { handler });
      },
    } as unknown as McpServer;
    const ctx = {
      plans,
      api: {
        agentJSON: async (_method: string, path: string) => {
          if (path.endsWith("/readiness")) return { version: 2, blockers: [{ code: "sync_conflicts" }] };
          if (path.endsWith("/evidence")) return { items: [] };
          throw new Error(`unexpected request: ${path}`);
        },
      },
    } as unknown as Ctx;
    registerPlanTools(server, ctx);

    const resume = tools.get("yaaif_plan_execution_resume");
    assert.ok(resume);
    const result = await resume.handler({ slug: "scenario-plan" });
    assert.equal(result.isError, true);
    assert.equal((result.structuredContent?.safety_halt as { code?: string }).code, "sync_conflicts");
    assert.equal((await plans.get("scenario-plan"))?.spec_version, 2);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
