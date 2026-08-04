import assert from "node:assert/strict";
import { test } from "node:test";
import { shapeOpsPayload } from "./opsShape.js";

test("summary_only keeps failures and drops ambient raw", () => {
  const shaped = shapeOpsPayload(
    {
      diagnostics_version: "ops-diagnostics/1",
      failures: [{ code: "x" }],
      next_steps: ["a"],
      ambient: { huge: true },
      session: { huge: true },
    },
    { summary_only: true },
  ) as Record<string, unknown>;
  assert.equal(shaped.diagnostics_version, "ops-diagnostics/1");
  assert.ok(Array.isArray(shaped.failures));
  assert.equal(shaped.ambient, undefined);
});

test("max_items truncates items array", () => {
  const items = Array.from({ length: 60 }, (_, i) => ({ i }));
  const shaped = shapeOpsPayload({ items }, { max_items: 10 }) as Record<string, unknown>;
  assert.equal((shaped.items as unknown[]).length, 10);
  assert.equal(shaped.items_truncated, true);
  assert.equal(shaped.items_original_count, 60);
});

test("max_chars returns preview when oversized", () => {
  const shaped = shapeOpsPayload(
    { blob: "x".repeat(10_000) },
    { max_chars: 200 },
  ) as Record<string, unknown>;
  assert.equal(shaped.truncated, true);
  assert.ok(String(shaped.preview).length <= 210);
});
