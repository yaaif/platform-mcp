import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { defaultBundledCliPath, stageStableBridge, stableBridgePath } from "./stableBridge.js";

test("stable bridge resolves and copies the self-contained bundle", async () => {
  const root = await mkdtemp(join(tmpdir(), "yaaif-stable-bridge-"));
  try {
    await mkdir(join(root, "dist", "lib"), { recursive: true });
    const source = join(root, "dist", "yaaif-platform-mcp.mjs");
    await writeFile(source, "bundled-cli\n");
    const meta = pathToFileURL(join(root, "dist", "lib", "pluginInstall.js")).href;
    assert.equal(defaultBundledCliPath(meta), source);
    const state = join(root, "state");
    const staged = await stageStableBridge(state, source);
    assert.equal(staged, stableBridgePath(state));
    assert.match(staged, /yaaif-platform-mcp-1\.7\.0\.mjs$/);
    assert.equal(await readFile(staged, "utf8"), "bundled-cli\n");
    assert.doesNotMatch(staged, /_npx/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
