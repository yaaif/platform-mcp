import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { clientDescriptor } from "../config.js";
import { OPENCODE_TOOL_ALLOWLIST } from "./opencodeAllowlist.js";
import { registerAllTools } from "./register.js";
import type { Ctx } from "./ctx.js";

function names(client: "cursor" | "opencode"): string[] {
  const registered: string[] = [];
  const server = { registerTool(name: string) { registered.push(name); } } as unknown as McpServer;
  registerAllTools(server, { cfg: { client: clientDescriptor(client) } } as unknown as Ctx);
  return registered;
}

test("plugin contract covers registered families and required tools", async () => {
  const contract = JSON.parse(await readFile(new URL("../../plugin-contract.json", import.meta.url), "utf8")) as {
    bridgeVersion: string;
    mcpPackage: string;
    registrationModules: string[];
    requiredTools: Record<string, string[]>;
    openCode: { maxTools: number; requiredExpose: string[] };
  };
  const pkg = JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf8")) as { version: string };
  const registerSource = await readFile(new URL("./register.ts", import.meta.url), "utf8");
  const cursor = names("cursor");
  const opencode = names("opencode");
  assert.equal(contract.bridgeVersion, pkg.version);
  assert.equal(contract.mcpPackage, `@yaaif/platform-mcp@${pkg.version}`);
  for (const family of contract.registrationModules) {
    assert.match(registerSource, new RegExp(`${family}\\(server, ctx\\)`), `missing registration ${family}`);
  }
  for (const [family, tools] of Object.entries(contract.requiredTools)) {
    for (const tool of tools) assert.ok(cursor.includes(tool), `${family}: ${tool} is not registered`);
  }
  assert.equal(new Set(OPENCODE_TOOL_ALLOWLIST).size, OPENCODE_TOOL_ALLOWLIST.length);
  assert.ok(OPENCODE_TOOL_ALLOWLIST.length <= contract.openCode.maxTools);
  assert.ok(contract.openCode.maxTools <= 128);
  for (const tool of OPENCODE_TOOL_ALLOWLIST) assert.ok(opencode.includes(tool), `${tool} is not registered for OpenCode`);
  for (const tool of [...contract.requiredTools.credentials, ...contract.openCode.requiredExpose]) {
    assert.ok(OPENCODE_TOOL_ALLOWLIST.includes(tool), `${tool} missing from required OpenCode exposure`);
  }
});
