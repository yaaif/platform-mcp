import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverJetBrainsPluginsDir, installIntellijPlugin, installVsCodePlugin } from "./nativePlugin.js";

test("VS Code installer builds, packages and installs the VSIX", async () => {
  const root = await mkdtemp(join(tmpdir(), "yaaif-vscode-native-"));
  const calls: Array<{ file: string; args: string[] }> = [];
  try {
    const result = await installVsCodePlugin({
      client: "vscode",
      sourceDir: root,
      stateHome: join(root, "state"),
      offline: false,
      runCommand: async (file, args) => { calls.push({ file, args }); },
    });
    const artifact = join(root, "state", "packages", "yaaif-vscode-1.7.0.vsix");
    assert.equal(result.artifact, artifact);
    assert.equal(result.installed, true);
    assert.deepEqual(calls, [
      { file: "npm", args: ["ci"] },
      { file: "npm", args: ["run", "package", "--", "--out", artifact] },
      { file: "code", args: ["--install-extension", artifact] },
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("VS Code build-only mode leaves a manual artifact without invoking code", async () => {
  const root = await mkdtemp(join(tmpdir(), "yaaif-vscode-build-only-"));
  const calls: string[] = [];
  try {
    const result = await installVsCodePlugin({
      client: "vscode",
      sourceDir: root,
      stateHome: root,
      offline: true,
      buildOnly: true,
      runCommand: async (file) => { calls.push(file); },
    });
    assert.equal(result.installed, false);
    assert.deepEqual(calls, ["npm", "npm"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("IntelliJ installer builds and atomically replaces the plugin jar", async () => {
  const root = await mkdtemp(join(tmpdir(), "yaaif-intellij-native-"));
  const plugins = join(root, "plugins");
  try {
    await mkdir(plugins, { recursive: true });
    await writeFile(join(plugins, "yaaif-jetbrains.jar"), "old\n");
    const gradle = join(root, "gradlew");
    await writeFile(gradle, "#!/bin/sh\n");
    const result = await installIntellijPlugin({
      client: "intellij",
      sourceDir: root,
      stateHome: root,
      offline: false,
      gradlePath: gradle,
      jetbrainsPluginsDir: plugins,
      runCommand: async () => {
        await mkdir(join(root, "build", "libs"), { recursive: true });
        await writeFile(join(root, "build", "libs", "yaaif-jetbrains-1.7.0-base.jar"), "new\n");
      },
    });
    assert.equal(result.installed, true);
    assert.equal(await readFile(join(plugins, "yaaif-jetbrains.jar"), "utf8"), "new\n");
    assert.equal(await readFile(join(plugins, "yaaif-jetbrains.jar.backup"), "utf8"), "old\n");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("JetBrains discovery selects the newest product plugins directory", async () => {
  const home = await mkdtemp(join(tmpdir(), "yaaif-jetbrains-home-"));
  try {
    const older = join(home, "Library", "Application Support", "JetBrains", "IntelliJIdea2023.3", "plugins");
    const newer = join(home, "Library", "Application Support", "JetBrains", "IntelliJIdea2024.3", "plugins");
    await mkdir(older, { recursive: true });
    await mkdir(newer, { recursive: true });
    const now = Date.now() / 1000;
    const { utimes } = await import("node:fs/promises");
    await utimes(older, now - 100, now - 100);
    await utimes(newer, now, now);
    assert.equal(await discoverJetBrainsPluginsDir(home, "darwin"), newer);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
