import assert from "node:assert/strict";
import { mkdir, readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  MCP_PACKAGE_PIN,
  assertCursorPluginSrc,
  assertNode20,
  assertStableCliPath,
  buildMcpServerEntry,
  collectInstallHealth,
  compareDottedVersion,
  copyCursorPlugin,
  executeInstall,
  isUnstableCliPath,
  parseForce,
  parseInstallAction,
  parseInstallOptions,
  parseNoLogin,
  parseOffline,
  parsePluginSrc,
  pluginDestHealthy,
  resolveMcpJsonPath,
  shouldCopyPluginPath,
} from "./pluginInstall.js";

async function writeCli(dir: string): Promise<string> {
  const cli = join(dir, "cli.js");
  await writeFile(cli, "#!/usr/bin/env node\n");
  return cli;
}

test("parseInstall flags", () => {
  assert.equal(parseInstallAction(["--client", "cursor"]), false);
  assert.equal(parseInstallAction(["--install", "--client", "cursor"]), true);
  assert.equal(parsePluginSrc(["--plugin-src", "/tmp/p"]), "/tmp/p");
  assert.equal(parsePluginSrc(["--plugin-src=/tmp/p"]), "/tmp/p");
  assert.equal(parseOffline(["--offline"]), true);
  assert.equal(parseNoLogin(["--no-login"]), true);
  assert.equal(parseForce(["--force"]), true);
});

test("parseInstallOptions requires --client", () => {
  assert.throws(() => parseInstallOptions(["--install"]), /--client/);
  const opts = parseInstallOptions([
    "--install",
    "--client",
    "claude",
    "--offline",
    "--plugin-src",
    ".",
    "--force",
    "--cli-path",
    "/opt/cli.js",
  ]);
  assert.equal(opts.client, "claude");
  assert.equal(opts.offline, true);
  assert.equal(opts.force, true);
  assert.equal(opts.cliPathExplicit, true);
});

test("assertNode20 rejects old majors", () => {
  assert.doesNotThrow(() => assertNode20("20.11.0"));
  assert.doesNotThrow(() => assertNode20("22.0.0"));
  assert.throws(() => assertNode20("18.20.0"), /Node.js >= 20/);
});

test("compareDottedVersion orders releases", () => {
  assert.equal(compareDottedVersion("1.1.0", "1.3.0"), -1);
  assert.equal(compareDottedVersion("1.3.0", "1.3.0"), 0);
  assert.equal(compareDottedVersion("1.4.0", "1.3.0"), 1);
});

test("isUnstableCliPath detects npx cache", () => {
  assert.equal(isUnstableCliPath("/Users/me/.npm/_npx/abc/node_modules/@yaaif/platform-mcp/dist/cli.js"), true);
  assert.equal(isUnstableCliPath("/opt/yaaif/platform-mcp/dist/cli.js"), false);
  assert.throws(
    () => assertStableCliPath("/tmp/.npm/_npx/x/cli.js"),
    /npx cache/,
  );
  assert.doesNotThrow(() => assertStableCliPath("/tmp/.npm/_npx/x/cli.js", true));
});

test("buildMcpServerEntry uses absolute node for Cursor even when online", () => {
  const cursor = buildMcpServerEntry({
    client: "cursor",
    offline: false,
    nodePath: "/usr/bin/node",
    cliPath: "/opt/yaaif/cli.js",
  });
  assert.equal(cursor.command, "/usr/bin/node");
  assert.deepEqual(cursor.args, ["/opt/yaaif/cli.js", "--client", "cursor"]);
  assert.equal(cursor.env?.YAAIF_API_BASE_URL, "${YAAIF_API_BASE_URL}");

  const claudeOnline = buildMcpServerEntry({ client: "claude", offline: false });
  assert.equal(claudeOnline.command, "npx");
  assert.deepEqual(claudeOnline.args, ["-y", MCP_PACKAGE_PIN, "--client", "claude"]);
  assert.equal(claudeOnline.env?.YAAIF_OIDC_AUTHORITY, "${user_config.YAAIF_OIDC_AUTHORITY}");

  const offline = buildMcpServerEntry({
    client: "codex",
    offline: true,
    nodePath: "/usr/bin/node",
    cliPath: "/opt/yaaif/cli.js",
  });
  assert.equal(offline.command, "/usr/bin/node");
  assert.deepEqual(offline.args, ["/opt/yaaif/cli.js", "--client", "codex"]);
});

test("shouldCopyPluginPath excludes git, installer, and node_modules", () => {
  const root = "/tmp/plugin";
  assert.equal(shouldCopyPluginPath(root, "/tmp/plugin"), true);
  assert.equal(shouldCopyPluginPath(root, "/tmp/plugin/skills/yaaif-auth/SKILL.md"), true);
  assert.equal(shouldCopyPluginPath(root, "/tmp/plugin/.git/HEAD"), false);
  assert.equal(shouldCopyPluginPath(root, "/tmp/plugin/installer/lib/install.sh"), false);
  assert.equal(shouldCopyPluginPath(root, "/tmp/plugin/packages/mcp/node_modules/zod/index.js"), false);
});

test("resolveMcpJsonPath prefers Codex nested plugin", async () => {
  const home = await mkdtemp(join(tmpdir(), "yaaif-mcp-json-"));
  try {
    await mkdir(join(home, "plugins", "yaaif-platform"), { recursive: true });
    await writeFile(join(home, "plugins", "yaaif-platform", ".mcp.json"), "{}\n");
    assert.equal(resolveMcpJsonPath("codex", home), join(home, "plugins", "yaaif-platform", ".mcp.json"));
    assert.equal(resolveMcpJsonPath("claude", home), join(home, ".mcp.json"));
    assert.equal(resolveMcpJsonPath("cursor", home), join(home, "mcp.json"));
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("copyCursorPlugin skips excluded trees", async () => {
  const src = await mkdtemp(join(tmpdir(), "yaaif-src-"));
  const dest = await mkdtemp(join(tmpdir(), "yaaif-dest-"));
  try {
    await mkdir(join(src, ".cursor-plugin"), { recursive: true });
    await mkdir(join(src, "installer", "lib"), { recursive: true });
    await mkdir(join(src, "packages", "mcp", "node_modules", "zod"), { recursive: true });
    await writeFile(join(src, ".cursor-plugin", "plugin.json"), '{"name":"yaaif"}\n');
    await writeFile(join(src, "installer", "lib", "install.sh"), "echo no\n");
    await writeFile(join(src, "packages", "mcp", "node_modules", "zod", "index.js"), "module.exports={}\n");
    await copyCursorPlugin(src, dest);
    const copied = await readFile(join(dest, ".cursor-plugin", "plugin.json"), "utf8");
    assert.match(copied, /yaaif/);
    await assert.rejects(readFile(join(dest, "installer", "lib", "install.sh")));
    await assert.rejects(readFile(join(dest, "packages", "mcp", "node_modules", "zod", "index.js")));
  } finally {
    await rm(src, { recursive: true, force: true });
    await rm(dest, { recursive: true, force: true });
  }
});

test("assertCursorPluginSrc requires plugin.json version", async () => {
  const src = await mkdtemp(join(tmpdir(), "yaaif-bad-"));
  try {
    assert.throws(() => assertCursorPluginSrc(src), /not a Cursor plugin/);
    await mkdir(join(src, ".cursor-plugin"), { recursive: true });
    await writeFile(join(src, ".cursor-plugin", "plugin.json"), '{"name":"yaaif"}\n');
    assert.throws(() => assertCursorPluginSrc(src), /missing version/);
  } finally {
    await rm(src, { recursive: true, force: true });
  }
});

test("collectInstallHealth flags Cursor npx launch", async () => {
  const dest = await mkdtemp(join(tmpdir(), "yaaif-health-"));
  try {
    await mkdir(join(dest, ".cursor-plugin"), { recursive: true });
    await writeFile(join(dest, ".cursor-plugin", "plugin.json"), '{"version":"1.3.0"}\n');
    await writeFile(
      join(dest, "mcp.json"),
      JSON.stringify({ mcpServers: { yaaif: { command: "npx", args: ["-y", MCP_PACKAGE_PIN, "--client", "cursor"] } } }),
    );
    assert.equal(pluginDestHealthy(dest), true);
    const checks = collectInstallHealth({ client: "cursor", cursorDest: dest, nodeVersion: "22.0.0" });
    assert.equal(checks.find((c) => c.name === "node_runtime")?.ok, true);
    assert.equal(checks.find((c) => c.name === "cursor_plugin_dest")?.ok, true);
    assert.equal(checks.find((c) => c.name === "mcp_launch")?.ok, false);
  } finally {
    await rm(dest, { recursive: true, force: true });
  }
});

test("executeInstall cursor --no-login copies plugin and writes absolute mcp.json", async () => {
  const src = await mkdtemp(join(tmpdir(), "yaaif-plug-"));
  const dest = await mkdtemp(join(tmpdir(), "yaaif-dest-"));
  const home = await mkdtemp(join(tmpdir(), "yaaif-home-"));
  const prevHome = process.env.YAAIF_CURSOR_HOME;
  const prevLogin = process.env.YAAIF_INSTALLER_NO_LOGIN;
  delete process.env.YAAIF_INSTALLER_NO_LOGIN;
  process.env.YAAIF_CURSOR_HOME = home;
  try {
    const cliPath = await writeCli(src);
    await mkdir(join(src, ".cursor-plugin"), { recursive: true });
    await writeFile(join(src, ".cursor-plugin", "plugin.json"), '{"name":"yaaif","version":"1.3.0"}\n');
    await writeFile(join(src, "mcp.json"), '{"mcpServers":{}}\n');
    const code = await executeInstall(
      {
        client: "cursor",
        pluginSrc: src,
        offline: false,
        noLogin: true,
        force: false,
        cliPathExplicit: true,
        cursorDest: dest,
        nodePath: process.execPath,
        cliPath,
      },
      { argv: ["--client", "cursor"], probe: async () => false, interactive: false },
    );
    assert.equal(code, 0);
    assert.equal(process.env.YAAIF_INSTALLER_NO_LOGIN, undefined);
    const mcp = JSON.parse(await readFile(join(dest, "mcp.json"), "utf8")) as {
      mcpServers: { yaaif: { command: string; args: string[] } };
    };
    assert.equal(mcp.mcpServers.yaaif.command, process.execPath);
    assert.deepEqual(mcp.mcpServers.yaaif.args, [cliPath, "--client", "cursor"]);
    const plugin = await readFile(join(dest, ".cursor-plugin", "plugin.json"), "utf8");
    assert.match(plugin, /1\.3\.0/);
    assert.equal(existsSync(`${dest}.__staging`), false);
    assert.equal(existsSync(`${dest}.__old`), false);
    const active = JSON.parse(await readFile(join(home, "active-profile.json"), "utf8")) as { profile_id: string };
    assert.equal(active.profile_id, "hosted");
  } finally {
    if (prevHome === undefined) delete process.env.YAAIF_CURSOR_HOME;
    else process.env.YAAIF_CURSOR_HOME = prevHome;
    if (prevLogin === undefined) delete process.env.YAAIF_INSTALLER_NO_LOGIN;
    else process.env.YAAIF_INSTALLER_NO_LOGIN = prevLogin;
    await rm(src, { recursive: true, force: true });
    await rm(dest, { recursive: true, force: true });
    await rm(home, { recursive: true, force: true });
  }
});

test("executeInstall skips copy when dest is newer unless --force", async () => {
  const src = await mkdtemp(join(tmpdir(), "yaaif-plug-"));
  const dest = await mkdtemp(join(tmpdir(), "yaaif-dest-"));
  const home = await mkdtemp(join(tmpdir(), "yaaif-home-"));
  const prevHome = process.env.YAAIF_CURSOR_HOME;
  process.env.YAAIF_CURSOR_HOME = home;
  try {
    const cliPath = await writeCli(src);
    await mkdir(join(src, ".cursor-plugin"), { recursive: true });
    await writeFile(join(src, ".cursor-plugin", "plugin.json"), '{"name":"yaaif","version":"1.3.0"}\n');
    await mkdir(join(dest, ".cursor-plugin"), { recursive: true });
    await writeFile(join(dest, ".cursor-plugin", "plugin.json"), '{"name":"yaaif","version":"1.4.0"}\n');
    await writeFile(join(dest, "mcp.json"), '{"mcpServers":{"yaaif":{"command":"npx"}}}\n');
    await writeFile(join(dest, "keep.txt"), "keep\n");
    const base = {
      client: "cursor" as const,
      pluginSrc: src,
      offline: false,
      noLogin: true,
      cliPathExplicit: true,
      cursorDest: dest,
      nodePath: process.execPath,
      cliPath,
    };
    const skipped = await executeInstall(
      { ...base, force: false },
      { argv: ["--client", "cursor"], probe: async () => false, interactive: false },
    );
    assert.equal(skipped, 0);
    assert.match(await readFile(join(dest, ".cursor-plugin", "plugin.json"), "utf8"), /1\.4\.0/);
    assert.equal(await readFile(join(dest, "keep.txt"), "utf8"), "keep\n");
    const forced = await executeInstall(
      { ...base, force: true },
      { argv: ["--client", "cursor"], probe: async () => false, interactive: false },
    );
    assert.equal(forced, 0);
    assert.match(await readFile(join(dest, ".cursor-plugin", "plugin.json"), "utf8"), /1\.3\.0/);
  } finally {
    if (prevHome === undefined) delete process.env.YAAIF_CURSOR_HOME;
    else process.env.YAAIF_CURSOR_HOME = prevHome;
    await rm(src, { recursive: true, force: true });
    await rm(dest, { recursive: true, force: true });
    await rm(home, { recursive: true, force: true });
  }
});

test("executeInstall refuses npx-cache cli paths unless --cli-path", async () => {
  const src = await mkdtemp(join(tmpdir(), "yaaif-plug-"));
  const dest = await mkdtemp(join(tmpdir(), "yaaif-dest-"));
  try {
    await mkdir(join(src, ".cursor-plugin"), { recursive: true });
    await writeFile(join(src, ".cursor-plugin", "plugin.json"), '{"name":"yaaif","version":"1.3.0"}\n');
    await assert.rejects(
      () =>
        executeInstall(
          {
            client: "cursor",
            pluginSrc: src,
            offline: false,
            noLogin: true,
            force: false,
            cliPathExplicit: false,
            cursorDest: dest,
            cliPath: "/tmp/.npm/_npx/abc/cli.js",
          },
          { argv: ["--client", "cursor"] },
        ),
      /npx cache/,
    );
  } finally {
    await rm(src, { recursive: true, force: true });
    await rm(dest, { recursive: true, force: true });
  }
});

test("executeInstall cursor without --plugin-src fails", async () => {
  await assert.rejects(
    () =>
      executeInstall(
        { client: "cursor", offline: false, noLogin: true, force: false, cliPathExplicit: false },
        { argv: ["--client", "cursor"] },
      ),
    /--plugin-src is required/,
  );
});

test("executeInstall claude --offline rewrites .mcp.json and keeps user_config env", async () => {
  const src = await mkdtemp(join(tmpdir(), "yaaif-claude-"));
  const home = await mkdtemp(join(tmpdir(), "yaaif-chome-"));
  const prevHome = process.env.YAAIF_CLAUDE_HOME;
  const prevLogin = process.env.YAAIF_INSTALLER_NO_LOGIN;
  delete process.env.YAAIF_INSTALLER_NO_LOGIN;
  process.env.YAAIF_CLAUDE_HOME = home;
  try {
    const cliPath = await writeCli(src);
    await writeFile(
      join(src, ".mcp.json"),
      JSON.stringify({
        mcpServers: {
          yaaif: {
            command: "npx",
            args: ["-y", MCP_PACKAGE_PIN, "--client", "claude"],
            env: { YAAIF_API_BASE_URL: "${user_config.YAAIF_API_BASE_URL}" },
          },
        },
      }),
    );
    const code = await executeInstall(
      {
        client: "claude",
        pluginSrc: src,
        offline: true,
        noLogin: true,
        force: false,
        cliPathExplicit: true,
        nodePath: process.execPath,
        cliPath,
      },
      { argv: ["--client", "claude"], probe: async () => false, interactive: false },
    );
    assert.equal(code, 0);
    assert.equal(process.env.YAAIF_INSTALLER_NO_LOGIN, undefined);
    const mcp = JSON.parse(await readFile(join(src, ".mcp.json"), "utf8")) as {
      mcpServers: { yaaif: { command: string; args: string[]; env: Record<string, string> } };
    };
    assert.equal(mcp.mcpServers.yaaif.command, process.execPath);
    assert.deepEqual(mcp.mcpServers.yaaif.args, [cliPath, "--client", "claude"]);
    assert.equal(mcp.mcpServers.yaaif.env.YAAIF_API_BASE_URL, "${user_config.YAAIF_API_BASE_URL}");
  } finally {
    if (prevHome === undefined) delete process.env.YAAIF_CLAUDE_HOME;
    else process.env.YAAIF_CLAUDE_HOME = prevHome;
    if (prevLogin === undefined) delete process.env.YAAIF_INSTALLER_NO_LOGIN;
    else process.env.YAAIF_INSTALLER_NO_LOGIN = prevLogin;
    await rm(src, { recursive: true, force: true });
    await rm(home, { recursive: true, force: true });
  }
});
