import assert from "node:assert/strict";
import test from "node:test";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { renderToolTable } from "./output.js";

function result(structuredContent: Record<string, unknown>): CallToolResult {
  return { content: [{ type: "text", text: "Loaded features." }], structuredContent };
}

test("table renders feature capabilities with status and permissions", () => {
  const text = renderToolTable(result({
    features: {
      wiki: { status: "permission_denied", supported: true, accessible: false, permission: "agent.memory.read" },
    },
  }));
  assert.match(text, /FEATURE\s+STATUS\s+SUPPORTED\s+ACCESSIBLE\s+PERMISSION/);
  assert.match(text, /wiki\s+permission_denied\s+true\s+false\s+agent.memory.read/);
});

test("table unwraps catalog items and caps nested values", () => {
  const text = renderToolTable(result({
    result: { items: [{ id: "a1", name: "Agent", definition: { large: "x".repeat(100) } }] },
  }));
  assert.match(text, /ID\s+NAME\s+DEFINITION/);
  assert.match(text, /a1\s+Agent/);
  assert.match(text, /…/);
});

test("table falls back to scalar status fields", () => {
  const text = renderToolTable(result({ authenticated: false, profile_id: "local" }));
  assert.match(text, /AUTHENTICATED\s+PROFILE_ID/);
  assert.match(text, /false\s+local/);
});
