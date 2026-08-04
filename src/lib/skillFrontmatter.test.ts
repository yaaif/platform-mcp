import assert from "node:assert/strict";
import { test } from "node:test";
import {
  extractSkillToolsFromMarkdown,
  verifyToolsAgainstCatalogs,
} from "./skillFrontmatter.js";

test("extractSkillToolsFromMarkdown prefers allowed-tools list", () => {
  const md = `---
name: demo
allowed-tools:
  - list_ambient_workflows
  - trigger_ambient_workflow
tools:
  - ignored_when_allowed_present
---
# Body
`;
  assert.deepEqual(extractSkillToolsFromMarkdown(md), [
    "list_ambient_workflows",
    "trigger_ambient_workflow",
  ]);
});

test("extractSkillToolsFromMarkdown supports inline tools array", () => {
  const md = `---
name: demo
tools: [files_list, file_load_context]
---
`;
  assert.deepEqual(extractSkillToolsFromMarkdown(md), ["files_list", "file_load_context"]);
});

test("verifyToolsAgainstCatalogs splits local vs mcp vs missing", () => {
  const result = verifyToolsAgainstCatalogs(
    ["files_list", "get_invoice", "not_real"],
    ["files_list", "skill_validate_module"],
    ["get_invoice"],
  );
  assert.equal(result.ok, false);
  assert.deepEqual(result.found_local, ["files_list"]);
  assert.deepEqual(result.found_mcp, ["get_invoice"]);
  assert.deepEqual(result.missing, ["not_real"]);
});
