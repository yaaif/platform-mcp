import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cleanupVersionedCache, retirePluginPaths } from "./pluginCleanup.js";
import { cleanupAfterInstall } from "./pluginInstall.js";
import type { NativeInstallResult } from "./nativePlugin.js";

test("versioned cleanup moves old plugins to backup and preserves current and unrelated files", async () => {
  const root = await mkdtemp(join(tmpdir(), "yaaif-cleanup-cache-"));
  const backup = join(root, "backups");
  try {
    for (const version of ["1.3.2", "1.3.3", "1.7.0"]) {
      await mkdir(join(root, version, ".claude-plugin"), { recursive: true });
      await writeFile(join(root, version, ".claude-plugin", "plugin.json"), JSON.stringify({ version }));
    }
    await writeFile(join(root, "not-a-plugin"), "keep");
    await mkdir(join(root, "broken"), { recursive: true });
    const result = await cleanupVersionedCache({ client: "claude", cacheRoot: root, currentVersion: "1.7.0", backupRoot: backup });
    assert.deepEqual(result.removed.sort(), [join(root, "1.3.2"), join(root, "1.3.3")].sort());
    assert.equal(existsSync(join(root, "1.7.0")), true);
    assert.equal(existsSync(join(root, "1.3.2")), false);
    assert.equal(existsSync(join(root, "1.3.3")), false);
    assert.equal(existsSync(join(root, "not-a-plugin")), true);
    assert.equal(existsSync(join(root, "broken")), true);
    assert.equal(JSON.parse(await readFile(join(result.backupDir!, "1.3.2", ".claude-plugin", "plugin.json"), "utf8")).version, "1.3.2");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cleanup is a no-op when the current version is not installed", async () => {
  const root = await mkdtemp(join(tmpdir(), "yaaif-cleanup-missing-"));
  try {
    await mkdir(join(root, "1.3.2", ".codex-plugin"), { recursive: true });
    await writeFile(join(root, "1.3.2", ".codex-plugin", "plugin.json"), '{"version":"1.3.2"}');
    const result = await cleanupVersionedCache({ client: "codex", cacheRoot: root, currentVersion: "1.7.0", backupRoot: join(root, "backups") });
    assert.deepEqual(result.removed, []);
    assert.equal(existsSync(join(root, "1.3.2")), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("retirePluginPaths backs up files and directories before removal", async () => {
  const root = await mkdtemp(join(tmpdir(), "yaaif-retire-paths-"));
  try {
    const file = join(root, "old.vsix");
    const directory = join(root, "old-plugin");
    await writeFile(file, "old");
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, "plugin.txt"), "old");
    const result = await retirePluginPaths([file, directory, join(root, "missing")], join(root, "backups"));
    assert.equal(existsSync(file), false);
    assert.equal(existsSync(directory), false);
    assert.equal(await readFile(join(result.backupDir!, "old.vsix"), "utf8"), "old");
    assert.equal(await readFile(join(result.backupDir!, "old-plugin", "plugin.txt"), "utf8"), "old");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("post-install cleanup covers Cursor, Claude, VS Code and IntelliJ", async () => {
  const root = await mkdtemp(join(tmpdir(), "yaaif-cleanup-all-clients-"));
  const env: Record<string, string> = {};
  try {
    env.YAAIF_CURSOR_HOME = join(root, "cursor-state");
    env.YAAIF_CLAUDE_HOME = join(root, "claude-state");
    env.YAAIF_VSCODE_HOME = join(root, "vscode-state");
    env.YAAIF_INTELLIJ_HOME = join(root, "intellij-state");
    Object.assign(process.env, env);
    const base = { offline: false, noLogin: true, force: false, cliPathExplicit: false };

    const cursorDest = join(root, "cursor-plugin");
    await mkdir(`${cursorDest}.__old`, { recursive: true });
    await mkdir(`${cursorDest}.__staging`, { recursive: true });
    const cursorResult = await cleanupAfterInstall({ ...base, client: "cursor" }, cursorDest, undefined);
    assert.equal(existsSync(`${cursorDest}.__old`), false);
    assert.ok(cursorResult.backupDir);

    const cacheRoot = join(root, "claude-cache");
    for (const version of ["1.3.2", "1.7.0"]) {
      await mkdir(join(cacheRoot, version, ".claude-plugin"), { recursive: true });
      await writeFile(join(cacheRoot, version, ".claude-plugin", "plugin.json"), JSON.stringify({ version }));
    }
    const claudeResult = await cleanupAfterInstall({ ...base, client: "claude", pluginCacheRoot: cacheRoot }, undefined, undefined);
    assert.equal(existsSync(join(cacheRoot, "1.3.2")), false);
    assert.equal(existsSync(join(cacheRoot, "1.7.0")), true);
    assert.ok(claudeResult.backupDir);

    const packages = join(root, "vscode-state", "packages");
    await mkdir(packages, { recursive: true });
    await writeFile(join(packages, "yaaif-vscode-1.3.0.vsix"), "old");
    const currentVsix = join(packages, "yaaif-vscode-1.7.0.vsix");
    await writeFile(currentVsix, "current");
    const vscodeResult = await cleanupAfterInstall({ ...base, client: "vscode" }, undefined, { artifact: currentVsix, installed: true });
    assert.equal(existsSync(join(packages, "yaaif-vscode-1.3.0.vsix")), false);
    assert.equal(existsSync(currentVsix), true);
    assert.ok(vscodeResult.backupDir);

    const pluginsDir = join(root, "intellij-plugins");
    await mkdir(pluginsDir, { recursive: true });
    await writeFile(join(pluginsDir, "yaaif-jetbrains.jar"), "current");
    await writeFile(join(pluginsDir, "yaaif-jetbrains.jar.backup"), "old");
    await writeFile(join(pluginsDir, "yaaif-jetbrains-1.3.0-base.jar"), "old");
    const nativeResult: NativeInstallResult = { artifact: "artifact", installed: true, pluginsDir };
    const intellijResult = await cleanupAfterInstall({ ...base, client: "intellij" }, undefined, nativeResult);
    assert.equal(existsSync(join(pluginsDir, "yaaif-jetbrains.jar")), true);
    assert.equal(existsSync(join(pluginsDir, "yaaif-jetbrains.jar.backup")), false);
    assert.equal(existsSync(join(pluginsDir, "yaaif-jetbrains-1.3.0-base.jar")), false);
    assert.ok(intellijResult.backupDir);

    const backups = await readdir(join(root, "vscode-state", "plugin-backups"));
    assert.ok(backups.length > 0);
  } finally {
    for (const key of Object.keys(env)) delete process.env[key];
    await rm(root, { recursive: true, force: true });
  }
});

test("keepOldVersions preserves old artifacts", async () => {
  const root = await mkdtemp(join(tmpdir(), "yaaif-cleanup-keep-old-"));
  const previous = process.env.YAAIF_VSCODE_HOME;
  process.env.YAAIF_VSCODE_HOME = join(root, "state");
  try {
    const packages = join(root, "state", "packages");
    await mkdir(packages, { recursive: true });
    await writeFile(join(packages, "yaaif-vscode-1.3.0.vsix"), "old");
    const result = await cleanupAfterInstall({
      client: "vscode",
      offline: false,
      noLogin: true,
      force: false,
      cliPathExplicit: false,
      keepOldVersions: true,
    }, undefined, { artifact: join(packages, "yaaif-vscode-1.7.0.vsix"), installed: true });
    assert.deepEqual(result.removed, []);
    assert.equal(existsSync(join(packages, "yaaif-vscode-1.3.0.vsix")), true);
  } finally {
    if (previous === undefined) delete process.env.YAAIF_VSCODE_HOME;
    else process.env.YAAIF_VSCODE_HOME = previous;
    await rm(root, { recursive: true, force: true });
  }
});
