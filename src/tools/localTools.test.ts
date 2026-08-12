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

// Keep in sync with registerLocalTools file aliases + registerFiles REST tools.
const FILE_LOCAL_ALIASES = [
  "yaaif_files_list",
  "yaaif_files_search",
  "yaaif_file_load_context",
  "yaaif_load_artifacts",
  "yaaif_file_share_link",
  "yaaif_generate_file",
] as const;

const FILE_HTTP_TOOLS = [
  "yaaif_file_artifact_versions",
  "yaaif_file_artifact_delete",
  "yaaif_file_get_extracted",
  "yaaif_session_files_list",
] as const;

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
  assert.equal(MUTATING_ACK_TOOLS.has("load_artifacts"), false);
});

test("file local aliases cover ADK artifact surface", () => {
  assert.ok(FILE_LOCAL_ALIASES.includes("yaaif_load_artifacts"));
  assert.ok(FILE_LOCAL_ALIASES.includes("yaaif_file_load_context"));
  assert.ok(FILE_LOCAL_ALIASES.includes("yaaif_files_list"));
  assert.ok(FILE_LOCAL_ALIASES.includes("yaaif_generate_file"));
  assert.equal(FILE_LOCAL_ALIASES.length, 6);
});

test("file HTTP tools cover artifact versions + extracted", () => {
  assert.ok(FILE_HTTP_TOOLS.includes("yaaif_file_artifact_versions"));
  assert.ok(FILE_HTTP_TOOLS.includes("yaaif_file_get_extracted"));
  assert.ok(FILE_HTTP_TOOLS.includes("yaaif_session_files_list"));
  assert.equal(FILE_HTTP_TOOLS.length, 4);
});
