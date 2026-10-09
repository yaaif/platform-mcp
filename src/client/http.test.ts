import assert from "node:assert/strict";
import test from "node:test";
import { boundedErrorText } from "./http.js";

test("short error bodies pass through trimmed", () => {
  assert.equal(boundedErrorText("  not found\n"), "not found");
});

test("long error bodies are cut and say how much", () => {
  const out = boundedErrorText(`<html>${"x".repeat(5000)}</html>`);
  assert.ok(out.length < 560);
  assert.match(out, /^<html>x+/);
  assert.match(out, /\[truncated \d+ chars\]$/);
});
