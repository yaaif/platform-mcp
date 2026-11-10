import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { captureFileBackup, restoreFileBackup, restoreIntellijPlugin, restoreStagedPlugin } from "./installRollback.js";

test("file backup restores launcher contents and removes newly created files", async () => {
  const root = await mkdtemp(join(tmpdir(), "yaaif-file-rollback-"));
  try {
    const path = join(root, "mcp.json");
    await writeFile(path, "before");
    const backup = await captureFileBackup(path);
    await writeFile(path, "after");
    await restoreFileBackup(backup);
    assert.equal(await readFile(path, "utf8"), "before");
    const missing = join(root, "new.json");
    const missingBackup = await captureFileBackup(missing);
    await writeFile(missing, "new");
    await restoreFileBackup(missingBackup);
    assert.equal(existsSync(missing), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("staged plugin rollback restores previous installation and removes new files", async () => {
  const root = await mkdtemp(join(tmpdir(), "yaaif-staged-rollback-"));
  const dest = join(root, "plugin");
  const old = `${dest}.__old`;
  const staging = `${dest}.__staging`;
  try {
    await mkdir(old, { recursive: true });
    await writeFile(join(old, "version.txt"), "previous");
    await mkdir(dest, { recursive: true });
    await writeFile(join(dest, "version.txt"), "broken");
    await mkdir(staging, { recursive: true });
    await restoreStagedPlugin(staging, dest);
    assert.equal(await readFile(join(dest, "version.txt"), "utf8"), "previous");
    assert.equal(existsSync(staging), false);
    assert.equal(existsSync(old), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("IntelliJ rollback restores the previous jar and removes a new install without history", async () => {
  const root = await mkdtemp(join(tmpdir(), "yaaif-jar-rollback-"));
  try {
    await writeFile(join(root, "yaaif-jetbrains.jar"), "broken");
    await writeFile(join(root, "yaaif-jetbrains.jar.backup"), "previous");
    await restoreIntellijPlugin(root);
    assert.equal(await readFile(join(root, "yaaif-jetbrains.jar"), "utf8"), "previous");
    await rm(join(root, "yaaif-jetbrains.jar.backup"));
    await restoreIntellijPlugin(root);
    assert.equal(existsSync(join(root, "yaaif-jetbrains.jar")), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
