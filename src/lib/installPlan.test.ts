import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInstallPlan } from "./installPlan.js";
import { executeInstall } from "./pluginInstall.js";

test("dry-run describes the matching source and native actions without side effects", async () => {
  const home = await mkdtemp(join(tmpdir(), "yaaif-install-plan-"));
  const previous = process.env.YAAIF_VSCODE_HOME;
  process.env.YAAIF_VSCODE_HOME = home;
  try {
    const plan = await createInstallPlan({
      client: "vscode",
      offline: false,
      noLogin: true,
      force: false,
      cliPathExplicit: false,
      codePath: "/opt/code",
    });
    assert.equal(plan.dry_run, true);
    assert.equal(plan.target_version, "1.7.0");
    assert.equal(plan.source.kind, "download");
    assert.match(plan.source.location, /vscode-plugin\/tar.gz\/v1.7.0/);
    assert.ok(plan.actions.some((action) => action.includes("npm run package")));
    assert.ok(plan.actions.some((action) => action.includes("/opt/code")));
    assert.equal(plan.cleanup.policy, "backup-and-remove");
    assert.equal(plan.cleanup.backup_root, join(home, "plugin-backups"));
  } finally {
    if (previous === undefined) delete process.env.YAAIF_VSCODE_HOME;
    else process.env.YAAIF_VSCODE_HOME = previous;
    await rm(home, { recursive: true, force: true });
  }
});

test("dry-run reports current Cursor version and preserve policy", async () => {
  const dest = await mkdtemp(join(tmpdir(), "yaaif-plan-cursor-"));
  try {
    await mkdir(join(dest, ".cursor-plugin"), { recursive: true });
    await writeFile(join(dest, ".cursor-plugin", "plugin.json"), '{"version":"1.3.0"}');
    const plan = await createInstallPlan({
      client: "cursor",
      offline: false,
      noLogin: true,
      force: false,
      cliPathExplicit: false,
      cursorDest: dest,
      keepOldVersions: true,
    });
    assert.equal(plan.current_version, "1.3.0");
    assert.equal(plan.cleanup.policy, "preserve");
  } finally {
    await rm(dest, { recursive: true, force: true });
  }
});

test("executeInstall dry-run returns before downloads or writes", async () => {
  const home = await mkdtemp(join(tmpdir(), "yaaif-execute-plan-"));
  const previous = process.env.YAAIF_VSCODE_HOME;
  const previousLog = console.log;
  let output = "";
  process.env.YAAIF_VSCODE_HOME = home;
  console.log = (value: unknown) => { output += String(value); };
  let downloads = 0;
  try {
    const code = await executeInstall({
      client: "vscode",
      offline: false,
      noLogin: true,
      force: false,
      cliPathExplicit: false,
      dryRun: true,
      pluginSourceDownloader: async () => {
        downloads += 1;
        throw new Error("download must not run");
      },
    }, { argv: ["--client", "vscode"], probe: async () => false, interactive: false });
    assert.equal(code, 0);
    assert.equal(downloads, 0);
    assert.match(output, /"dry_run": true/);
    assert.match(output, /"target_version": "1.7.0"/);
    assert.deepEqual(await import("node:fs/promises").then(({ readdir }) => readdir(home)), []);
  } finally {
    console.log = previousLog;
    if (previous === undefined) delete process.env.YAAIF_VSCODE_HOME;
    else process.env.YAAIF_VSCODE_HOME = previous;
    await rm(home, { recursive: true, force: true });
  }
});
