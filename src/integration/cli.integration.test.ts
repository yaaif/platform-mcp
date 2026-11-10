import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const entry = fileURLToPath(new URL("../yaaif-cli.ts", import.meta.url));

function run(args: string[], state: string) {
  return spawnSync(process.execPath, ["--import", "tsx", entry, ...args], {
    encoding: "utf8",
    env: { ...process.env, YAAIF_CLI_HOME: state },
    timeout: 20_000,
  });
}

test("built-in CLI process runs help, version, tools and whoami", async () => {
  const state = await mkdtemp(join(tmpdir(), "yaaif-cli-process-"));
  try {
    const help = run(["--help"], state);
    assert.equal(help.status, 0, help.stderr);
    assert.match(help.stdout, /tools call TOOL/);
    const version = run(["--version"], state);
    assert.equal(version.stdout.trim(), "1.7.0");
    const list = run(["tools", "list", "credential", "--json"], state);
    assert.equal(list.status, 0, list.stderr);
    const tools = JSON.parse(list.stdout) as Array<{ name: string }>;
    assert.ok(tools.some((tool) => tool.name === "yaaif_credential_create"));
    const whoami = run(["whoami", "--json"], state);
    assert.equal(whoami.status, 0, whoami.stderr);
    assert.equal(JSON.parse(whoami.stdout).authenticated, false);
    const table = run(["whoami", "--table"], state);
    assert.equal(table.status, 0, table.stderr);
    assert.match(table.stdout, /AUTHENTICATED\s+PROFILE_ID/);
    const conflicting = run(["whoami", "--json", "--table"], state);
    assert.equal(conflicting.status, 2);
    assert.match(conflicting.stderr, /only one/);
    const invalid = run(["tools", "call", "yaaif_agent_get", "--args", "[]"], state);
    assert.equal(invalid.status, 2);
    assert.match(invalid.stderr, /JSON object/);
    for (const shell of ["bash", "zsh", "fish"]) {
      const completion = run(["completion", shell], state);
      assert.equal(completion.status, 0, completion.stderr);
      assert.match(completion.stdout, /wiki/);
      assert.ok(completion.stdout.includes(shell === "fish" ? "-l table" : "--table"));
    }
  } finally {
    await rm(state, { recursive: true, force: true });
  }
});
