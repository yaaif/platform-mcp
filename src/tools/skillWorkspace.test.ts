import test from "node:test";
import assert from "node:assert/strict";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Ctx } from "./ctx.js";
import { registerAllTools } from "./register.js";
import { clientDescriptor } from "../config.js";

function fixture() {
  const calls: unknown[][] = [];
  const handlers = new Map<string, (args: any) => Promise<unknown>>();
  registerAllTools(
    {
      registerTool(
        name: string,
        _config: unknown,
        handler: (args: any) => Promise<unknown>,
      ) {
        handlers.set(name, handler);
      },
    } as unknown as McpServer,
    {
      cfg: {
        client: clientDescriptor("cursor"),
        stateHome: "/tmp/skill-workspace-tests",
      },
      api: {
        async agentJSON(...args: unknown[]) {
          calls.push(args);
          return {};
        },
      },
    } as unknown as Ctx,
  );
  return { calls, run: (name: string, args: any) => handlers.get(name)!(args) };
}

test("file inspection, conditional edits and structural validation keep the selected branch", async () => {
  const { calls, run } = fixture();
  await run("yaaif_skill_file_tree", { path: "folder/a", branch: "team/fix" });
  await run("yaaif_skill_read_file", {
    path: "folder/a/SKILL.md",
    branch: "team/fix",
  });
  await run("yaaif_skill_write_file", {
    path: "folder/a/SKILL.md",
    content: "changed",
    branch: "team/fix",
    if_match: 'W/"old"',
  });
  await run("yaaif_skill_validate", { branch: "team/fix", strict: true });
  assert.deepEqual(calls, [
    ["GET", "/api/skill-files/tree?path=folder%2Fa&branch=team%2Ffix"],
    [
      "GET",
      "/api/skill-files/content?path=folder%2Fa%2FSKILL.md&branch=team%2Ffix",
    ],
    [
      "PUT",
      "/api/skill-files/content?branch=team%2Ffix",
      { path: "folder/a/SKILL.md", content: "changed" },
      { headers: { "If-Match": 'W/"old"' } },
    ],
    ["POST", "/api/skills/validate?branch=team%2Ffix", { strict: true }],
  ]);
});

test("local lifecycle aliases carry branch selection into resolved workspaces", async () => {
  const { calls, run } = fixture();
  await run("yaaif_skill_update_module_files", {
    branch: "team/fix",
    session_id: "session-test",
    agent_id: "agent-test",
    arguments: { skill_id: "example", files: [] },
  });
  assert.equal(calls[0][1], "/api/local-tools/skill_update_module_files/call");
  assert.equal((calls[0][2] as Record<string, unknown>).branch, "team/fix");
  assert.equal(
    (calls[0][2] as Record<string, unknown>).resolve_workspace,
    true,
  );
});
