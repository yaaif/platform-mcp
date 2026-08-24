import assert from "node:assert/strict";
import test from "node:test";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { clientDescriptor } from "../config.js";
import type { Ctx } from "./ctx.js";
import { registerAllTools } from "./register.js";

function registeredNames(client: "cursor" | "codex"): string[] {
  const names: string[] = [];
  const server = {
    registerTool(name: string) {
      names.push(name);
    },
  } as unknown as McpServer;
  const ctx = { cfg: { client: clientDescriptor(client) } } as unknown as Ctx;
  registerAllTools(server, ctx);
  return names.sort();
}

test("Cursor and Codex descriptors register the same YAAIF MCP tool contract", () => {
  const cursor = registeredNames("cursor");
  const codex = registeredNames("codex");

  assert.equal(new Set(cursor).size, cursor.length);
  assert.ok(cursor.length >= 169);
  assert.deepEqual(codex, cursor);
});
