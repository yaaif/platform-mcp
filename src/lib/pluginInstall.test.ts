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
  parseBuildOnly,
  parseCodePath,
  parseGradlePath,
  parseJetbrainsPluginsDir,
  parseKeepOldVersions,
  parseDryRun,
  parsePluginSrc,
  parsePluginRef,
  parsePluginSha256,
  parsePluginSourceBaseUrl,
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
  assert.equal(parsePluginRef(["--plugin-ref", "v1.7.0"]), "v1.7.0");
  assert.equal(parsePluginSha256(["--plugin-sha256", "a".repeat(64)]), "a".repeat(64));
  assert.equal(parsePluginSourceBaseUrl(["--plugin-source-base-url", "https://mirror.example/yaaif"]), "https://mirror.example/yaaif");
  assert.equal(parseBuildOnly(["--build-only"]), true);
  assert.equal(parseCodePath(["--code-path", "/opt/code"]), "/opt/code");
  assert.equal(parseGradlePath(["--gradle-path", "/opt/gradle"]), "/opt/gradle");
  assert.equal(parseJetbrainsPluginsDir(["--jetbrains-plugins-dir", "/opt/plugins"]), "/opt/plugins");
  assert.equal(parseKeepOldVersions(["--keep-old-versions"]), true);
  assert.equal(parseDryRun(["--dry-run"]), true);
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

  const vscodeOnline = buildMcpServerEntry({ client: "vscode", offline: false });
  assert.equal(vscodeOnline.command, "npx");
  assert.deepEqual(vscodeOnline.args, ["-y", MCP_PACKAGE_PIN, "--client", "vscode"]);

  const intellijOnline = buildMcpServerEntry({ client: "intellij", offline: false });
  assert.equal(intellijOnline.command, "npx");
  assert.deepEqual(intellijOnline.args, ["-y", MCP_PACKAGE_PIN, "--client", "intellij"]);

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
    assert.equal(resolveMcpJsonPath("vscode", home), join(home, ".mcp.json"));
    assert.equal(resolveMcpJsonPath("intellij", home), join(home, ".mcp.json"));
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

test("executeInstall downloads matching Cursor source when --plugin-src is omitted", async () => {
  const src = await mkdtemp(join(tmpdir(), "yaaif-download-src-"));
  const dest = await mkdtemp(join(tmpdir(), "yaaif-download-dest-"));
  const home = await mkdtemp(join(tmpdir(), "yaaif-download-home-"));
  const prevHome = process.env.YAAIF_CURSOR_HOME;
  process.env.YAAIF_CURSOR_HOME = home;
  let cleaned = false;
  try {
    const bridgeSource = await writeCli(src);
    await mkdir(join(src, ".cursor-plugin"), { recursive: true });
    await writeFile(join(src, ".cursor-plugin", "plugin.json"), '{"name":"yaaif","version":"1.7.0"}\n');
    await writeFile(join(src, "mcp.json"), '{"mcpServers":{}}\n');
    const code = await executeInstall(
      {
        client: "cursor",
        offline: false,
        noLogin: true,
        force: false,
        cliPathExplicit: false,
        cursorDest: dest,
        bridgeSource,
        pluginSourceDownloader: async () => ({
          path: src,
          cleanup: async () => { cleaned = true; },
        }),
      },
      { argv: ["--client", "cursor"], probe: async () => false, interactive: false },
    );
    assert.equal(code, 0);
    assert.equal(cleaned, true);
    assert.match(await readFile(join(dest, ".cursor-plugin", "plugin.json"), "utf8"), /1\.7\.0/);
    assert.match(await readFile(join(home, "bridge", "yaaif-platform-mcp-1.7.0.mjs"), "utf8"), /env node/);
  } finally {
    if (prevHome === undefined) delete process.env.YAAIF_CURSOR_HOME;
    else process.env.YAAIF_CURSOR_HOME = prevHome;
    await rm(src, { recursive: true, force: true });
    await rm(dest, { recursive: true, force: true });
    await rm(home, { recursive: true, force: true });
  }
});

test("executeInstall offline requires an explicit plugin source", async () => {
  await assert.rejects(
    () => executeInstall(
      { client: "cursor", offline: true, noLogin: true, force: false, cliPathExplicit: false },
      { argv: ["--client", "cursor"] },
    ),
    /--plugin-src is required with --offline/,
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
        pluginCacheRoot: join(home, "cache"),
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

test("executeInstall stages the bundled bridge outside the npx cache by default", async () => {
  const src = await mkdtemp(join(tmpdir(), "yaaif-plug-default-"));
  const dest = await mkdtemp(join(tmpdir(), "yaaif-dest-default-"));
  const home = await mkdtemp(join(tmpdir(), "yaaif-home-default-"));
  const prevHome = process.env.YAAIF_CURSOR_HOME;
  process.env.YAAIF_CURSOR_HOME = home;
  try {
    const bridgeSource = await writeCli(src);
    await mkdir(join(src, ".cursor-plugin"), { recursive: true });
    await writeFile(join(src, ".cursor-plugin", "plugin.json"), '{"name":"yaaif","version":"1.7.0"}\n');
    await writeFile(join(src, "mcp.json"), '{"mcpServers":{}}\n');
    const code = await executeInstall(
      {
        client: "cursor",
        pluginSrc: src,
        offline: false,
        noLogin: true,
        force: false,
        cliPathExplicit: false,
        cursorDest: dest,
        nodePath: process.execPath,
        bridgeSource,
      },
      { argv: ["--client", "cursor"], probe: async () => false, interactive: false },
    );
    assert.equal(code, 0);
    const mcp = JSON.parse(await readFile(join(dest, "mcp.json"), "utf8")) as {
      mcpServers: { yaaif: { command: string; args: string[] } };
    };
    const staged = join(home, "bridge", "yaaif-platform-mcp-1.7.0.mjs");
    assert.equal(mcp.mcpServers.yaaif.command, process.execPath);
    assert.deepEqual(mcp.mcpServers.yaaif.args, [staged, "--client", "cursor"]);
    assert.equal(await readFile(staged, "utf8"), "#!/usr/bin/env node\n");
    assert.doesNotMatch(staged, /_npx/);
  } finally {
    if (prevHome === undefined) delete process.env.YAAIF_CURSOR_HOME;
    else process.env.YAAIF_CURSOR_HOME = prevHome;
    await rm(src, { recursive: true, force: true });
    await rm(dest, { recursive: true, force: true });
    await rm(home, { recursive: true, force: true });
  }
});

test("executeInstall keeps downloaded Claude source in managed state", async () => {
  const src = await mkdtemp(join(tmpdir(), "yaaif-claude-download-src-"));
  const home = await mkdtemp(join(tmpdir(), "yaaif-claude-download-home-"));
  const prevHome = process.env.YAAIF_CLAUDE_HOME;
  process.env.YAAIF_CLAUDE_HOME = home;
  let cleaned = false;
  try {
    await writeFile(join(src, ".mcp.json"), JSON.stringify({
      mcpServers: { yaaif: { command: "npx", args: ["-y", MCP_PACKAGE_PIN, "--client", "claude"], env: { KEEP: "yes" } } },
    }));
    const code = await executeInstall(
      {
        client: "claude",
        offline: false,
        noLogin: true,
        force: false,
        cliPathExplicit: false,
        pluginSourceDownloader: async () => ({ path: src, cleanup: async () => { cleaned = true; } }),
        pluginCacheRoot: join(home, "cache"),
      },
      { argv: ["--client", "claude"], probe: async () => false, interactive: false },
    );
    assert.equal(code, 0);
    assert.equal(cleaned, true);
    const mcp = JSON.parse(await readFile(join(home, "plugin", ".mcp.json"), "utf8")) as {
      mcpServers: { yaaif: { args: string[]; env: Record<string, string> } };
    };
    assert.deepEqual(mcp.mcpServers.yaaif.args, ["-y", MCP_PACKAGE_PIN, "--client", "claude"]);
    assert.equal(mcp.mcpServers.yaaif.env.KEEP, "yes");
  } finally {
    if (prevHome === undefined) delete process.env.YAAIF_CLAUDE_HOME;
    else process.env.YAAIF_CLAUDE_HOME = prevHome;
    await rm(src, { recursive: true, force: true });
    await rm(home, { recursive: true, force: true });
  }
});

for (const client of ["vscode", "intellij"] as const) {
  test(`executeInstall invokes the ${client} native installer with downloaded source`, async () => {
    const src = await mkdtemp(join(tmpdir(), `yaaif-${client}-native-src-`));
    const home = await mkdtemp(join(tmpdir(), `yaaif-${client}-native-home-`));
    const envName = client === "vscode" ? "YAAIF_VSCODE_HOME" : "YAAIF_INTELLIJ_HOME";
    const previous = process.env[envName];
    process.env[envName] = home;
    let cleaned = false;
    let nativeSource = "";
    try {
      const code = await executeInstall(
        {
          client,
          offline: false,
          noLogin: true,
          force: false,
          cliPathExplicit: false,
          buildOnly: true,
          pluginSourceDownloader: async () => ({ path: src, cleanup: async () => { cleaned = true; } }),
          nativeInstaller: async (options) => {
            nativeSource = options.sourceDir;
            return { artifact: join(home, "artifact"), installed: false };
          },
        },
        { argv: ["--client", client], probe: async () => false, interactive: false },
      );
      assert.equal(code, 0);
      assert.equal(nativeSource, src);
      assert.equal(cleaned, true);
    } finally {
      if (previous === undefined) delete process.env[envName];
      else process.env[envName] = previous;
      await rm(src, { recursive: true, force: true });
      await rm(home, { recursive: true, force: true });
    }
  });
}

test("failed Cursor verification restores the previous plugin and launcher", async () => {
  const src = await mkdtemp(join(tmpdir(), "yaaif-rollback-cursor-src-"));
  const dest = await mkdtemp(join(tmpdir(), "yaaif-rollback-cursor-dest-"));
  const home = await mkdtemp(join(tmpdir(), "yaaif-rollback-cursor-home-"));
  const previous = process.env.YAAIF_CURSOR_HOME;
  process.env.YAAIF_CURSOR_HOME = home;
  try {
    const cliPath = await writeCli(src);
    await mkdir(join(src, ".cursor-plugin"), { recursive: true });
    await writeFile(join(src, ".cursor-plugin", "plugin.json"), '{"version":"1.7.0"}');
    await writeFile(join(src, "mcp.json"), '{"mcpServers":{}}');
    await mkdir(join(dest, ".cursor-plugin"), { recursive: true });
    await writeFile(join(dest, ".cursor-plugin", "plugin.json"), '{"version":"1.3.0"}');
    await writeFile(join(dest, "mcp.json"), '{"mcpServers":{"yaaif":{"command":"original"}}}');
    await assert.rejects(() => executeInstall({
      client: "cursor",
      pluginSrc: src,
      offline: true,
      noLogin: true,
      force: false,
      cliPathExplicit: true,
      cursorDest: dest,
      nodePath: "/missing/node",
      cliPath,
      pluginCacheRoot: join(home, "cache"),
    }, { argv: ["--client", "cursor"], probe: async () => false, interactive: false }), /install verify failed/);
    assert.match(await readFile(join(dest, ".cursor-plugin", "plugin.json"), "utf8"), /1\.3\.0/);
    const mcp = JSON.parse(await readFile(join(dest, "mcp.json"), "utf8")) as { mcpServers: { yaaif: { command: string } } };
    assert.equal(mcp.mcpServers.yaaif.command, "original");
    assert.equal(existsSync(`${dest}.__old`), false);
    assert.equal(existsSync(`${dest}.__staging`), false);
  } finally {
    if (previous === undefined) delete process.env.YAAIF_CURSOR_HOME;
    else process.env.YAAIF_CURSOR_HOME = previous;
    await rm(src, { recursive: true, force: true });
    await rm(dest, { recursive: true, force: true });
    await rm(home, { recursive: true, force: true });
  }
});

test("failed managed Claude install restores source and launcher", async () => {
  const src = await mkdtemp(join(tmpdir(), "yaaif-rollback-claude-src-"));
  const home = await mkdtemp(join(tmpdir(), "yaaif-rollback-claude-home-"));
  const previous = process.env.YAAIF_CLAUDE_HOME;
  process.env.YAAIF_CLAUDE_HOME = home;
  try {
    await writeFile(join(src, ".mcp.json"), '{"mcpServers":{"yaaif":{"command":"new"}}}');
    const managed = join(home, "plugin");
    await mkdir(managed, { recursive: true });
    await writeFile(join(managed, ".mcp.json"), '{"mcpServers":{"yaaif":{"command":"previous"}}}');
    await writeFile(join(home, "active-profile.json"), "not-json");
    await assert.rejects(() => executeInstall({
      client: "claude",
      offline: false,
      noLogin: true,
      force: false,
      cliPathExplicit: false,
      pluginCacheRoot: join(home, "cache"),
      pluginSourceDownloader: async () => ({ path: src, cleanup: async () => undefined }),
    }, { argv: ["--client", "claude"], probe: async () => false, interactive: false }));
    const mcp = JSON.parse(await readFile(join(managed, ".mcp.json"), "utf8")) as { mcpServers: { yaaif: { command: string } } };
    assert.equal(mcp.mcpServers.yaaif.command, "previous");
    assert.equal(existsSync(`${managed}.__old`), false);
  } finally {
    if (previous === undefined) delete process.env.YAAIF_CLAUDE_HOME;
    else process.env.YAAIF_CLAUDE_HOME = previous;
    await rm(src, { recursive: true, force: true });
    await rm(home, { recursive: true, force: true });
  }
});

test("failed native install rolls back VS Code and IntelliJ artifacts", async () => {
  const src = await mkdtemp(join(tmpdir(), "yaaif-rollback-native-src-"));
  const home = await mkdtemp(join(tmpdir(), "yaaif-rollback-native-home-"));
  const previousVscode = process.env.YAAIF_VSCODE_HOME;
  const previousIntellij = process.env.YAAIF_INTELLIJ_HOME;
  process.env.YAAIF_VSCODE_HOME = home;
  process.env.YAAIF_INTELLIJ_HOME = home;
  try {
    await writeFile(join(home, "active-profile.json"), "not-json");
    const packages = join(home, "packages");
    await mkdir(packages, { recursive: true });
    await writeFile(join(packages, "yaaif-vscode-1.7.0.vsix"), "previous-vsix");
    const pluginsDir = join(home, "plugins");
    await mkdir(pluginsDir, { recursive: true });
    await writeFile(join(pluginsDir, "yaaif-jetbrains.jar.backup"), "previous-jar");
    const calls: string[] = [];
    await assert.rejects(() => executeInstall({
      client: "vscode",
      pluginSrc: src,
      offline: false,
      noLogin: true,
      force: false,
      cliPathExplicit: false,
      nativeInstaller: async () => ({ artifact: join(packages, "yaaif-vscode-1.7.0.vsix"), installed: true }),
      nativeCommandRunner: async (file) => { calls.push(file); },
    }, { argv: ["--client", "vscode"], probe: async () => false, interactive: false }));
    assert.ok(calls.includes("code"));
    await assert.rejects(() => executeInstall({
      client: "intellij",
      pluginSrc: src,
      offline: false,
      noLogin: true,
      force: false,
      cliPathExplicit: false,
      nativeInstaller: async () => ({ artifact: "new-jar", installed: true, pluginsDir }),
    }, { argv: ["--client", "intellij"], probe: async () => false, interactive: false }));
    assert.equal(await readFile(join(pluginsDir, "yaaif-jetbrains.jar"), "utf8"), "previous-jar");
  } finally {
    if (previousVscode === undefined) delete process.env.YAAIF_VSCODE_HOME;
    else process.env.YAAIF_VSCODE_HOME = previousVscode;
    if (previousIntellij === undefined) delete process.env.YAAIF_INTELLIJ_HOME;
    else process.env.YAAIF_INTELLIJ_HOME = previousIntellij;
    await rm(src, { recursive: true, force: true });
    await rm(home, { recursive: true, force: true });
  }
});
