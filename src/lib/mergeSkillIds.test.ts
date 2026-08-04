import assert from "node:assert/strict";
import { test } from "node:test";
import { mergeSkillIds } from "./mergeSkillIds.js";

test("mergeSkillIds preserves existing order and appends new", () => {
  assert.deepEqual(mergeSkillIds(["a", "b"], ["b", "c"]), ["a", "b", "c"]);
});

test("mergeSkillIds trims and drops empties", () => {
  assert.deepEqual(mergeSkillIds([" a ", ""], ["", "b"]), ["a", "b"]);
});
