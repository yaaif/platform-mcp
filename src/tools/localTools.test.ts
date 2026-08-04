import test from "node:test";
import assert from "node:assert/strict";

// Keep in sync with agent-service LocalToolRequiresMutatingAck + registerLocalTools.
const MUTATING_ACK_TOOLS = new Set([
  "skill_archive_or_delete",
  "skill_repo_ops",
  "skill_release_manager",
  "ambient_approval_delete",
  "session_state_delete",
]);

test("mutating ack allowlist covers high-impact locals", () => {
  for (const name of [
    "skill_archive_or_delete",
    "skill_repo_ops",
    "skill_release_manager",
  ]) {
    assert.equal(MUTATING_ACK_TOOLS.has(name), true);
  }
  assert.equal(MUTATING_ACK_TOOLS.has("skill_validate_module"), false);
  assert.equal(MUTATING_ACK_TOOLS.has("files_list"), false);
});
