import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkPlugin, installOrUpdatePlugin, loadPluginContract, nativeUpdateInstruction } from "./plugins.js";

test("plugin contract matches the prepared release", async () => {
  const contract = await loadPluginContract();
  assert.equal(contract.bridgeVersion, "1.7.0");
  assert.equal(contract.mcpPackage, "@yaaif/platform-mcp@1.7.0");
  assert.match(nativeUpdateInstruction("vscode"), /Extensions view/);
});

test("Cursor source check accepts a healthy absolute MCP launch", async () => {
  const root = await mkdtemp(join(tmpdir(), "yaaif-cursor-check-"));
  try {
    await mkdir(join(root, ".cursor-plugin"), { recursive: true });
    await writeFile(join(root, ".cursor-plugin", "plugin.json"), JSON.stringify({ version: "1.7.0" }));
    await writeFile(join(root, "mcp.json"), JSON.stringify({
      mcpServers: {
        yaaif: {
          command: process.execPath,
          args: [fileURLToPath(new URL("../../src/cli.ts", import.meta.url)), "--client", "cursor"],
        },
      },
    }));
    const result = await checkPlugin({ client: "cursor", pluginSrc: root });
    assert.equal(result.ok, true, JSON.stringify(result.checks));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("marketplace update reports native action without writing", async () => {
  const code = await installOrUpdatePlugin("update", "claude", []);
  assert.equal(code, 0);
});
