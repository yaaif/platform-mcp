import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Ctx } from "./ctx.js";
import { registerAllTools } from "./register.js";
import { clientDescriptor } from "../config.js";

const root = new URL("../../../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");
const monorepo = existsSync(
  new URL("docker/opencode/agents/yaaif-governance.md", root),
);

test(
  "OpenCode governance routing exposes a bounded tool set and denies direct mutation tools",
  { skip: !monorepo },
  () => {
    const agent = read("docker/opencode/agents/yaaif-governance.md");
    const rules = [...agent.matchAll(/^  "([^"]+)": (allow|deny)$/gm)].map(
      ([, pattern, effect]) => ({ pattern, effect }),
    );
    const allowed = (name: string) => {
      let value = false;
      for (const rule of rules)
        if (
          new RegExp(
            `^${rule.pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\\\*/g, ".*")}$`,
          ).test(`YAA_F_${name}`)
        )
          value = rule.effect === "allow";
      return value;
    };
    const names: string[] = [];
    registerAllTools(
      {
        registerTool: (name: string) => names.push(name),
      } as unknown as McpServer,
      { cfg: { client: clientDescriptor("opencode") } } as Ctx,
    );
    const exposed = names.filter(allowed);
    assert.ok(
      exposed.length < 100,
      `leave room for builtins: ${exposed.length}`,
    );
    assert.equal(
      exposed.filter((n) => n.startsWith("yaaif_governance_")).length,
      5,
    );
    assert.equal(allowed("yaaif_agent_update"), false);
    assert.equal(allowed("yaaif_local_tool_call"), false);
    assert.equal(allowed("yaaif_ambient_run_stop"), false);
    assert.match(
      read("docker/opencode/command/yaaif-governance.md"),
      /^agent: yaaif-governance$/m,
    );
  },
);

test(
  "six clients package the same governance skill and references",
  { skip: !monorepo },
  () => {
    const folders = [
      "docker/opencode/skills",
      "integrations/cursor-plugin/skills",
      "integrations/claude-plugin/skills",
      "integrations/codex-plugin/plugins/yaaif-platform/skills",
      "integrations/vscode-plugin/skills",
      "integrations/jetbrains-plugin/src/main/resources/skills",
    ];
    for (const file of [
      "SKILL.md",
      "references/requirements.md",
      "references/diagnosis.md",
    ]) {
      const expected = read(`${folders[0]}/yaaif-governance/${file}`);
      for (const folder of folders.slice(1))
        assert.equal(
          read(`${folder}/yaaif-governance/${file}`),
          expected,
          `${folder}/${file}`,
        );
    }
  },
);
