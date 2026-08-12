import test from "node:test";
import assert from "node:assert/strict";

// Contract smoke: module exports used by registerLocalTools + registerFiles.
import {
  resolveDevSessionId,
  resolveDevAgentId,
  persistDevSession,
  ensureDevSession,
} from "./devSession.js";

test("devSession helpers are exported", () => {
  assert.equal(typeof resolveDevSessionId, "function");
  assert.equal(typeof resolveDevAgentId, "function");
  assert.equal(typeof persistDevSession, "function");
  assert.equal(typeof ensureDevSession, "function");
});
