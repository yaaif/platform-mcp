/**
 * Optional live smoke: set YAAIF_INTEGRATION=1 and a valid session/profile.
 * Default run is skipped so CI stays offline.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { loadConfig } from "../config.js";

test("integration catalog ping (optional)", async (t) => {
  if (process.env.YAAIF_INTEGRATION !== "1") {
    t.skip("Set YAAIF_INTEGRATION=1 with an authenticated ~/.yaaif/cursor session to run");
    return;
  }
  const cfg = loadConfig();
  const res = await fetch(`${cfg.apiBaseUrl}/health`);
  assert.ok(res.status > 0);
});
