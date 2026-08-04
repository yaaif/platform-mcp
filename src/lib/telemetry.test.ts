import assert from "node:assert/strict";
import { test } from "node:test";
import { redactSecrets } from "./telemetry.js";

test("redactSecrets masks token-like keys", () => {
  const out = redactSecrets({
    access_token: "secret",
    nested: { refresh_token: "r", ok: 1 },
    Authorization: "Bearer x",
  }) as Record<string, unknown>;
  assert.equal(out.access_token, "[redacted]");
  assert.equal((out.nested as Record<string, unknown>).refresh_token, "[redacted]");
  assert.equal((out.nested as Record<string, unknown>).ok, 1);
  assert.equal(out.Authorization, "[redacted]");
});
