import { access, cp, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { constants as fsConstants } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { BridgeClient } from "../config.js";
import { clientDescriptor, loadConfig, parseBridgeClient } from "../config.js";
import { runInstallerSetup, type PlatformPromptFn, type ProfileProbeFn } from "./installerSetup.js";
import { downloadPluginSource, type DownloadedPluginSource } from "./pluginSource.js";
import { createInstallPlan } from "./installPlan.js";
import { installNativePlugin, type CommandRunner, type NativeInstallResult } from "./nativePlugin.js";
import { cleanupVersionedCache, retirePluginPaths, type CleanupResult } from "./pluginCleanup.js";
import { captureFileBackup, restoreFileBackup, restoreIntellijPlugin, restoreStagedPlugin, runInstallRollback, type InstallRollbackAction } from "./installRollback.js";
import { stageStableBridge, stableBridgePath } from "./stableBridge.js";
import { execFileSync } from "node:child_process";
import { MCP_PACKAGE_PIN, PACKAGE_VERSION } from "../version.js";

export { MCP_PACKAGE_PIN };

export const CURSOR_MCP_ENV: Record<string, string> = {
  YAAIF_PLATFORM_PROFILE: "${YAAIF_PLATFORM_PROFILE}",
  YAAIF_OIDC_AUTHORITY: "${YAAIF_OIDC_AUTHORITY}",
  YAAIF_OIDC_CLIENT_ID: "${YAAIF_OIDC_CLIENT_ID}",
  YAAIF_API_BASE_URL: "${YAAIF_API_BASE_URL}",
  YAAIF_AGENT_BASE_URL: "${YAAIF_AGENT_BASE_URL}",
  YAAIF_CONTROL_PLANE_BASE_URL: "${YAAIF_CONTROL_PLANE_BASE_URL}",
  YAAIF_APPROVAL_BASE_URL: "${YAAIF_APPROVAL_BASE_URL}",
  YAAIF_DEFAULT_TENANT_ID: "${YAAIF_DEFAULT_TENANT_ID}",
  YAAIF_EXTRA_CA_FILE: "${YAAIF_EXTRA_CA_FILE}",
};

export const CLAUDE_MCP_ENV: Record<string, string> = {
  YAAIF_PLATFORM_PROFILE: "${user_config.YAAIF_PLATFORM_PROFILE}",
  YAAIF_OIDC_AUTHORITY: "${user_config.YAAIF_OIDC_AUTHORITY}",
  YAAIF_API_BASE_URL: "${user_config.YAAIF_API_BASE_URL}",
  YAAIF_AGENT_BASE_URL: "${user_config.YAAIF_AGENT_BASE_URL}",
  YAAIF_CONTROL_PLANE_BASE_URL: "${user_config.YAAIF_CONTROL_PLANE_BASE_URL}",
  YAAIF_APPROVAL_BASE_URL: "${user_config.YAAIF_APPROVAL_BASE_URL}",
  YAAIF_DEFAULT_TENANT_ID: "${user_config.YAAIF_DEFAULT_TENANT_ID}",
  YAAIF_OIDC_CLIENT_ID: "${user_config.YAAIF_OIDC_CLIENT_ID}",
  YAAIF_EXTRA_CA_FILE: "${user_config.YAAIF_EXTRA_CA_FILE}",
  YAAIF_CLIENT_CERT_FILE: "${user_config.YAAIF_CLIENT_CERT_FILE}",
  YAAIF_CLIENT_KEY_FILE: "${user_config.YAAIF_CLIENT_KEY_FILE}",
};

export type InstallOptions = {
  client: BridgeClient;
  pluginSrc?: string;
  offline: boolean;
  noLogin: boolean;
  force: boolean;
  cliPathExplicit: boolean;
  cursorDest?: string;
  cliPath?: string;
  nodePath?: string;
  bridgeSource?: string;
  pluginRef?: string;
  pluginSha256?: string;
  pluginSourceBaseUrl?: string;
  pluginSourceDownloader?: () => Promise<DownloadedPluginSource>;
  buildOnly?: boolean;
  dryRun?: boolean;
  codePath?: string;
  gradlePath?: string;
  jetbrainsPluginsDir?: string;
  nativeInstaller?: typeof installNativePlugin;
  nativeCommandRunner?: CommandRunner;
  keepOldVersions?: boolean;
  pluginCacheRoot?: string;
};

export type McpServerEntry = {
  command: string;
  args: string[];
  env?: Record<string, string>;
};

type McpDoc = {
  mcpServers?: Record<string, McpServerEntry & Record<string, unknown>>;
  [key: string]: unknown;
};

export type InstallHealthCheck = { name: string; ok: boolean; detail?: unknown };

export function parseInstallAction(argv: string[]): boolean {
  return argv.includes("--install");
}

export function parsePluginSrc(argv: string[]): string | undefined {
  return flagValue(argv, "--plugin-src");
}

export function parsePluginRef(argv: string[]): string | undefined {
  return flagValue(argv, "--plugin-ref");
}

export function parsePluginSha256(argv: string[]): string | undefined {
  return flagValue(argv, "--plugin-sha256");
}

export function parsePluginSourceBaseUrl(argv: string[]): string | undefined {
  return flagValue(argv, "--plugin-source-base-url");
}

export function parseBuildOnly(argv: string[]): boolean {
  return argv.includes("--build-only");
}

export function parseDryRun(argv: string[]): boolean {
  return argv.includes("--dry-run");
}

export function parseKeepOldVersions(argv: string[]): boolean {
  return argv.includes("--keep-old-versions");
}

export function parseCodePath(argv: string[]): string | undefined {
  return flagValue(argv, "--code-path");
}

export function parseGradlePath(argv: string[]): string | undefined {
  return flagValue(argv, "--gradle-path");
}

export function parseJetbrainsPluginsDir(argv: string[]): string | undefined {
  return flagValue(argv, "--jetbrains-plugins-dir");
}

export function parseOffline(argv: string[]): boolean {
  return argv.includes("--offline");
}

export function parseNoLogin(argv: string[]): boolean {
  return argv.includes("--no-login");
}

export function parseForce(argv: string[]): boolean {
  return argv.includes("--force");
}

export function parseCliPath(argv: string[]): string | undefined {
  return flagValue(argv, "--cli-path");
}

export function parseInstallOptions(argv: string[]): InstallOptions {
  const client = parseBridgeClient(argv).id;
  const pluginSrc = parsePluginSrc(argv);
  const cliPath = parseCliPath(argv);
  return {
    client,
    pluginSrc: pluginSrc ? resolve(pluginSrc) : undefined,
    offline: parseOffline(argv),
    noLogin: parseNoLogin(argv),
    force: parseForce(argv),
    cliPathExplicit: Boolean(cliPath),
    cliPath: cliPath ? resolve(cliPath) : undefined,
    pluginRef: parsePluginRef(argv),
    pluginSha256: parsePluginSha256(argv),
    pluginSourceBaseUrl: parsePluginSourceBaseUrl(argv),
    buildOnly: parseBuildOnly(argv),
    dryRun: parseDryRun(argv),
    codePath: parseCodePath(argv),
    gradlePath: parseGradlePath(argv),
    jetbrainsPluginsDir: parseJetbrainsPluginsDir(argv),
    keepOldVersions: parseKeepOldVersions(argv),
  };
}

export function assertNode20(version = process.versions.node): void {
  const major = Number.parseInt(version.split(".")[0] ?? "", 10);
  if (!Number.isFinite(major) || major < 20) {
    throw new Error(`Node.js >= 20 is required (found ${version})`);
  }
}

export function compareDottedVersion(left: string, right: string): number {
  const a = left.split(".").map((part) => Number.parseInt(part, 10) || 0);
  const b = right.split(".").map((part) => Number.parseInt(part, 10) || 0);
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i += 1) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d < 0) return -1;
    if (d > 0) return 1;
  }
  return 0;
}

export function cursorPluginDest(home = homedir()): string {
  const override = (process.env.YAAIF_CURSOR_PLUGIN_DEST ?? "").trim();
  if (override) return resolve(override);
  return join(home, ".cursor", "plugins", "local", "yaaif");
}

export function isUnstableCliPath(p: string): boolean {
  const n = p.replace(/\\/g, "/");
  return n.includes("/_npx/") || n.includes("/.npm/_npx/");
}

export function assertStableCliPath(p: string, allowUnstable = false): void {
  if (!allowUnstable && isUnstableCliPath(p)) {
    throw new Error(
      `refusing to pin MCP CLI under npx cache (${p}); pass --cli-path to a stable install (npm install -g or dist/cli.js)`,
    );
  }
}

export function defaultCliJsPath(fromMetaUrl = import.meta.url): string {
  const candidates = [
    fileURLToPath(new URL("../cli.js", fromMetaUrl)),
    fileURLToPath(new URL("../cli.ts", fromMetaUrl)),
  ];
  for (const c of candidates) {
    if (existsSync(c) && !isUnstableCliPath(c)) return c;
  }
  const argv1 = (process.argv[1] ?? "").trim();
  if (argv1) {
    const resolved = resolve(argv1);
    if (existsSync(resolved) && !isUnstableCliPath(resolved)) return resolved;
  }
  throw new Error("could not resolve a stable MCP cli.js path; pass --cli-path");
}

export function defaultMcpEnv(client: BridgeClient): Record<string, string> | undefined {
  if (client === "cursor") return { ...CURSOR_MCP_ENV };
  if (client === "claude") return { ...CLAUDE_MCP_ENV };
  return undefined;
}

export function buildMcpServerEntry(opts: {
  client: BridgeClient;
  offline: boolean;
  nodePath?: string;
  cliPath?: string;
  env?: Record<string, string>;
}): McpServerEntry {
  const env = opts.env === undefined ? defaultMcpEnv(opts.client) : opts.env;
  const useAbsolute = opts.offline || opts.client === "cursor";
  const entry: McpServerEntry = useAbsolute
    ? {
        command: opts.nodePath ?? process.execPath,
        args: [opts.cliPath ?? defaultCliJsPath(), "--client", opts.client],
      }
    : {
        command: "npx",
        args: ["-y", MCP_PACKAGE_PIN, "--client", opts.client],
      };
  if (env && Object.keys(env).length > 0) entry.env = env;
  return entry;
}

export function resolveMcpJsonPath(client: BridgeClient, pluginRoot: string): string {
  if (client === "cursor") return join(pluginRoot, "mcp.json");
  const nested = join(pluginRoot, "plugins", "yaaif-platform", ".mcp.json");
  if (client === "codex" && existsSync(nested)) return nested;
  return join(pluginRoot, ".mcp.json");
}

export function shouldCopyPluginPath(srcRoot: string, from: string): boolean {
  const rel = relative(srcRoot, from);
  if (!rel || rel === ".") return true;
  const parts = rel.split(/[/\\]/);
  if (parts.includes(".git")) return false;
  if (parts[0] === "installer") return false;
  if (parts.includes("node_modules")) return false;
  return true;
}

export function readPluginVersion(pluginRoot: string): string {
  const path = join(pluginRoot, ".cursor-plugin", "plugin.json");
  if (!existsSync(path)) return "";
  try {
    const doc = JSON.parse(readFileSync(path, "utf8")) as { version?: unknown };
    return String(doc.version ?? "").trim();
  } catch {
    return "";
  }
}

export function pluginDestHealthy(dest: string): boolean {
  return existsSync(join(dest, ".cursor-plugin", "plugin.json")) && existsSync(join(dest, "mcp.json"));
}

export function assertCursorPluginSrc(src: string): void {
  const manifest = join(src, ".cursor-plugin", "plugin.json");
  if (!existsSync(manifest)) {
    throw new Error(`--plugin-src is not a Cursor plugin (missing ${manifest})`);
  }
  if (!readPluginVersion(src)) {
    throw new Error(`--plugin-src plugin.json is missing version (${manifest})`);
  }
}

export function assertMcpPluginSrc(client: BridgeClient, src: string): void {
  const mcpPath = resolveMcpJsonPath(client, src);
  if (!existsSync(mcpPath)) {
    throw new Error(`--plugin-src missing MCP config (${mcpPath})`);
  }
}

export async function copyCursorPlugin(src: string, dest: string): Promise<void> {
  await mkdir(dirname(dest), { recursive: true });
  await cp(src, dest, {
    recursive: true,
    force: true,
    filter: (from) => shouldCopyPluginPath(src, from),
  });
}

export async function stageCursorPlugin(src: string, dest: string): Promise<string> {
  const staging = `${dest}.__staging`;
  await rm(staging, { recursive: true, force: true });
  await mkdir(dirname(dest), { recursive: true });
  await cp(src, staging, {
    recursive: true,
    force: true,
    filter: (from) => shouldCopyPluginPath(src, from),
  });
  return staging;
}

export async function swapStagedPlugin(staging: string, dest: string): Promise<void> {
  const old = `${dest}.__old`;
  await rm(old, { recursive: true, force: true });
  if (existsSync(dest)) {
    await rename(dest, old);
  }
  try {
    await rename(staging, dest);
  } catch (e) {
    if (existsSync(old) && !existsSync(dest)) {
      await rename(old, dest).catch(() => undefined);
    }
    throw e;
  }
}

export async function writeMcpJson(path: string, entry: McpServerEntry): Promise<void> {
  let doc: McpDoc = {};
  if (existsSync(path)) {
    try {
      doc = JSON.parse(await readFile(path, "utf8")) as McpDoc;
    } catch {
      doc = {};
    }
  }
  const existing = doc.mcpServers?.yaaif;
  const next: McpServerEntry = {
    command: entry.command,
    args: entry.args,
  };
  const env = existing?.env ?? entry.env;
  if (env && Object.keys(env).length > 0) next.env = env;
  doc.mcpServers = { ...doc.mcpServers, yaaif: next };
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  await writeFile(tmp, `${JSON.stringify(doc, null, 2)}\n`, "utf8");
  await rename(tmp, path);
}

export function collectInstallHealth(opts: {
  client: BridgeClient | "cli";
  cursorDest?: string;
  mcpJsonPath?: string;
  nodeVersion?: string;
}): InstallHealthCheck[] {
  const checks: InstallHealthCheck[] = [];
  const nodeVersion = opts.nodeVersion ?? process.versions.node;
  const major = Number.parseInt(nodeVersion.split(".")[0] ?? "", 10);
  checks.push({
    name: "node_runtime",
    ok: Number.isFinite(major) && major >= 20,
    detail: { version: nodeVersion, hint: major >= 20 ? undefined : "Install Node.js >= 20 and re-run --install" },
  });

  if (opts.client === "cursor") {
    const dest = opts.cursorDest ?? cursorPluginDest();
    if (!existsSync(dest)) {
      checks.push({
        name: "cursor_plugin_dest",
        ok: true,
        detail: { dest, skipped: "not_local_install" },
      });
    } else {
      const healthy = pluginDestHealthy(dest);
      checks.push({
        name: "cursor_plugin_dest",
        ok: healthy,
        detail: {
          dest,
          hint: healthy ? undefined : "Re-run npx @yaaif/platform-mcp --install --client cursor --plugin-src <clone>",
        },
      });
      const mcpPath = opts.mcpJsonPath ?? join(dest, "mcp.json");
      checks.push(mcpLaunchCheck(opts.client, mcpPath));
    }
  } else if (opts.mcpJsonPath) {
    checks.push(mcpLaunchCheck(opts.client, opts.mcpJsonPath));
  }
  return checks;
}

export function mcpLaunchCheck(client: BridgeClient | "cli", mcpPath: string): InstallHealthCheck {
  if (!existsSync(mcpPath)) {
    return { name: "mcp_launch", ok: false, detail: { mcpPath, hint: "mcp.json missing" } };
  }
  try {
    const doc = JSON.parse(readFileSync(mcpPath, "utf8")) as McpDoc;
    const entry = doc.mcpServers?.yaaif;
    if (!entry?.command) {
      return { name: "mcp_launch", ok: false, detail: { mcpPath, hint: "mcpServers.yaaif.command missing" } };
    }
    if (entry.command === "npx") {
      const ok = client !== "cursor";
      return {
        name: "mcp_launch",
        ok,
        detail: {
          mcpPath,
          command: entry.command,
          args: entry.args,
          hint: ok
            ? undefined
            : "Cursor PATH often has no npx. Re-run --install so mcp.json uses absolute node + cli.js",
        },
      };
    }
    const commandOk = existsSync(entry.command);
    const cli = entry.args?.[0] ?? "";
    const cliOk = !cli || existsSync(cli);
    return {
      name: "mcp_launch",
      ok: commandOk && cliOk,
      detail: {
        mcpPath,
        command: entry.command,
        cli,
        hint: commandOk && cliOk ? undefined : "Launch command or CLI path is missing on disk",
      },
    };
  } catch (e) {
    return { name: "mcp_launch", ok: false, detail: { mcpPath, error: String(e) } };
  }
}

export async function verifyInstall(opts: {
  client: BridgeClient | "cli";
  cursorDest?: string;
  mcpJsonPath?: string;
}): Promise<InstallHealthCheck[]> {
  const checks = collectInstallHealth(opts);
  for (const check of checks) {
    if (check.name !== "mcp_launch" || !check.ok) continue;
    const mcpPath = opts.mcpJsonPath ?? (opts.cursorDest ? join(opts.cursorDest, "mcp.json") : "");
    if (!mcpPath || !existsSync(mcpPath)) continue;
    try {
      const doc = JSON.parse(await readFile(mcpPath, "utf8")) as McpDoc;
      const entry = doc.mcpServers?.yaaif;
      if (entry?.command && entry.command !== "npx") {
        await access(entry.command, fsConstants.F_OK);
      }
      const cli = entry?.args?.[0];
      if (cli && cli !== "-y" && existsSync(cli)) {
        await access(cli, fsConstants.F_OK);
      }
    } catch {
      check.ok = false;
    }
  }
  return checks;
}

export function nextSteps(opts: { client: BridgeClient; pluginDest?: string; pluginSrc?: string; nativeResult?: NativeInstallResult }): string {
  if (opts.client === "cursor") {
    const dest = opts.pluginDest ?? cursorPluginDest();
    return [
      `Installed Cursor plugin files to ${dest}`,
      "First install only: Cursor → Plugins → + Add → Add local plugin → that path.",
      "Then Developer: Reload Window, run /yaaif-login and /yaaif-doctor.",
    ].join("\n");
  }
  if (opts.client === "claude") {
    const dir = opts.pluginSrc;
    return [
      dir
        ? `claude --plugin-dir ${dir}`
        : "claude plugin marketplace add yaaif/claude-plugin && claude plugin install yaaif-platform",
      "Start a new Claude Code session, then /yaaif-platform:yaaif-login and /yaaif-platform:yaaif-doctor.",
    ].join("\n");
  }
  if (opts.client === "vscode") {
    return [
      opts.nativeResult?.installed
        ? "Installed the YAAIF VS Code extension. Reload VS Code, then run YAAIF: Configure MCP Bridge."
        : `Built ${opts.nativeResult?.artifact ?? "the YAAIF VSIX"}. Install it with code --install-extension, then run YAAIF: Configure MCP Bridge.`,
      "Open Copilot Chat and run the YAAIF login and doctor commands.",
    ].join("\n");
  }
  if (opts.client === "intellij") {
    return [
      opts.nativeResult?.installed
        ? `Installed the YAAIF IntelliJ plugin${opts.nativeResult.pluginsDir ? ` to ${opts.nativeResult.pluginsDir}` : ""}. Restart the IDE, then run YAAIF: Configure MCP Bridge.`
        : `Built ${opts.nativeResult?.artifact ?? "the YAAIF IntelliJ jar"}. Install it in JetBrains settings, then run YAAIF: Configure MCP Bridge.`,
      "Open JetBrains AI Assistant and run the YAAIF login and doctor commands.",
    ].join("\n");
  }
  if (opts.client === "opencode") {
    return [
      "OpenCode is served with the YAAIF installation. Each user signs in with yaaif_login in their own workspace.",
    ].join("\n");
  }
  const dir = opts.pluginSrc;
  return [
    dir
      ? `In Codex, add ${dir} as a local marketplace (yaaif) and install yaaif-platform.`
      : "In Codex, add the yaaif/codex-plugin clone as a local marketplace and install yaaif-platform.",
    "Start a new Codex task, then run $yaaif-login and $yaaif-doctor.",
  ].join("\n");
}

export async function runInstall(
  opts: { argv?: string[]; probe?: ProfileProbeFn; prompt?: PlatformPromptFn; interactive?: boolean } = {},
): Promise<number> {
  const argv = opts.argv ?? process.argv.slice(2);
  try {
    assertNode20();
    const parsed = parseInstallOptions(argv);
    return await executeInstall(parsed, {
      argv,
      probe: opts.probe,
      prompt: opts.prompt,
      interactive: opts.interactive,
    });
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    return 1;
  }
}

export async function cleanupAfterInstall(
  options: InstallOptions,
  pluginDest: string | undefined,
  nativeResult: NativeInstallResult | undefined,
): Promise<CleanupResult> {
  if (options.keepOldVersions || options.buildOnly) return { removed: [] };
  const { client } = options;
  const stateHome = loadConfig(clientDescriptor(client)).stateHome;
  const backupRoot = join(stateHome, "plugin-backups");
  if (client === "cursor") {
    if (!pluginDest) return { removed: [] };
    return await retirePluginPaths([`${pluginDest}.__old`, `${pluginDest}.__staging`], backupRoot);
  }
  if (client === "claude" || client === "codex") {
    const cacheRoot = options.pluginCacheRoot ?? join(homedir(), `.${client}`, "plugins", "cache", "yaaif", "yaaif-platform");
    return await cleanupVersionedCache({ client, cacheRoot, currentVersion: PACKAGE_VERSION, backupRoot });
  }
  if (client === "vscode") {
    const packagesDir = join(stateHome, "packages");
    if (!existsSync(packagesDir)) return { removed: [] };
    const currentArtifact = nativeResult?.artifact ?? join(packagesDir, `yaaif-vscode-${PACKAGE_VERSION}.vsix`);
    const old = (await readdir(packagesDir, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith(".vsix"))
      .map((entry) => join(packagesDir, entry.name))
      .filter((path) => path !== currentArtifact);
    return await retirePluginPaths(old, backupRoot);
  }
  if (!nativeResult?.installed || !nativeResult.pluginsDir) return { removed: [] };
  const old = (await readdir(nativeResult.pluginsDir, { withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => /^yaaif-jetbrains.*\.(?:jar|backup|tmp)$/.test(name) && name !== "yaaif-jetbrains.jar")
    .map((name) => join(nativeResult.pluginsDir!, name));
  return await retirePluginPaths(old, backupRoot);
}

export async function executeInstall(
  options: InstallOptions,
  setup: {
    argv: string[];
    probe?: ProfileProbeFn;
    prompt?: PlatformPromptFn;
    interactive?: boolean;
  } = { argv: [] },
): Promise<number> {
  if (options.dryRun) {
    console.log(JSON.stringify(await createInstallPlan(options), null, 2));
    return 0;
  }
  let pluginSrc = options.pluginSrc;
  let downloaded: DownloadedPluginSource | undefined;
  try {
    if (!pluginSrc && options.client !== "opencode") {
      if (options.offline) throw new Error("--plugin-src is required with --offline");
      downloaded = options.pluginSourceDownloader
        ? await options.pluginSourceDownloader()
        : await downloadPluginSource({ client: options.client, ref: options.pluginRef, sha256: options.pluginSha256, baseUrl: options.pluginSourceBaseUrl });
      pluginSrc = downloaded.path;
      if (options.client === "claude" || options.client === "codex") {
        const managed = join(loadConfig(clientDescriptor(options.client)).stateHome, "plugin");
        const staging = await stageCursorPlugin(pluginSrc, managed);
        await swapStagedPlugin(staging, managed);
        pluginSrc = managed;
      }
    }
    return await executeInstallWithSource({ ...options, pluginSrc }, setup);
  } finally {
    await downloaded?.cleanup();
  }
}

async function executeInstallWithSource(
  options: InstallOptions,
  setup: {
    argv: string[];
    probe?: ProfileProbeFn;
    prompt?: PlatformPromptFn;
    interactive?: boolean;
  },
): Promise<number> {
  const rollback: InstallRollbackAction[] = [];
  try {
    return await executeInstallWithSourceInner(options, setup, rollback);
  } catch (error) {
    await runInstallRollback(rollback, error);
    throw error;
  }
}

async function executeInstallWithSourceInner(
  options: InstallOptions,
  setup: {
    argv: string[];
    probe?: ProfileProbeFn;
    prompt?: PlatformPromptFn;
    interactive?: boolean;
  },
  rollback: InstallRollbackAction[],
): Promise<number> {
  const { client, offline, noLogin, force, cliPathExplicit } = options;
  const pluginSrc = options.pluginSrc;
  if (pluginSrc && !existsSync(pluginSrc)) {
    throw new Error(`--plugin-src not found: ${pluginSrc}`);
  }
  if (client === "cursor" && !pluginSrc) {
    throw new Error("--plugin-src is required to copy the Cursor plugin (clone yaaif/cursor-plugin first)");
  }
  if (client === "cursor" && pluginSrc) {
    assertCursorPluginSrc(pluginSrc);
  }
  if (pluginSrc && (client === "claude" || client === "codex")) {
    assertMcpPluginSrc(client, pluginSrc);
  }

  const useAbsolute = offline || client === "cursor";
  let cliPath = options.cliPath;
  let nodePath = options.nodePath;
  if (useAbsolute) {
    const stateHome = loadConfig(clientDescriptor(client)).stateHome;
    const cliBackup = await captureFileBackup(options.cliPath ?? stableBridgePath(stateHome));
    rollback.push(() => restoreFileBackup(cliBackup));
    cliPath = cliPath ?? await stageStableBridge(stateHome, options.bridgeSource);
    assertStableCliPath(cliPath, cliPathExplicit);
    nodePath = nodePath ?? process.execPath;
  }

  const launch = buildMcpServerEntry({
    client,
    offline: useAbsolute,
    nodePath,
    cliPath,
  });

  if (pluginSrc && (client === "claude" || client === "codex") && existsSync(`${pluginSrc}.__old`)) {
    rollback.push(() => restoreStagedPlugin(`${pluginSrc}.__staging`, pluginSrc));
  }

  let pluginDest: string | undefined;
  let mcpJsonPath: string | undefined;
  if (client === "cursor" && pluginSrc) {
    pluginDest = options.cursorDest ?? cursorPluginDest();
    const srcVersion = readPluginVersion(pluginSrc);
    const destVersion = readPluginVersion(pluginDest);
    const skipCopy =
      !force && pluginDestHealthy(pluginDest) && destVersion && compareDottedVersion(destVersion, srcVersion) > 0;
    if (skipCopy) {
      console.error(
        `install: dest ${pluginDest} is ${destVersion} (newer than package ${srcVersion}); skipping copy (pass --force to overwrite)`,
      );
      const backup = await captureFileBackup(join(pluginDest, "mcp.json"));
      rollback.push(() => restoreFileBackup(backup));
      await writeMcpJson(join(pluginDest, "mcp.json"), launch);
    } else {
      const staging = await stageCursorPlugin(pluginSrc, pluginDest);
      await writeMcpJson(join(staging, "mcp.json"), launch);
      await swapStagedPlugin(staging, pluginDest);
      rollback.push(() => restoreStagedPlugin(`${pluginDest}.__staging`, pluginDest!));
    }
    mcpJsonPath = join(pluginDest, "mcp.json");
  } else if (pluginSrc && (client === "claude" || client === "codex")) {
    mcpJsonPath = resolveMcpJsonPath(client, pluginSrc);
    const backup = await captureFileBackup(mcpJsonPath);
    rollback.push(() => restoreFileBackup(backup));
    await writeMcpJson(mcpJsonPath, launch);
  }

  let nativeResult: NativeInstallResult | undefined;
  if (pluginSrc && (client === "vscode" || client === "intellij")) {
    const stateHome = loadConfig(clientDescriptor(client)).stateHome;
    const previousVsix = client === "vscode"
      ? await captureFileBackup(join(stateHome, "packages", `yaaif-vscode-${PACKAGE_VERSION}.vsix`))
      : null;
    nativeResult = await (options.nativeInstaller ?? installNativePlugin)({
      client,
      sourceDir: pluginSrc,
      stateHome,
      offline,
      buildOnly: options.buildOnly,
      codePath: options.codePath,
      gradlePath: options.gradlePath,
      jetbrainsPluginsDir: options.jetbrainsPluginsDir,
      runCommand: options.nativeCommandRunner,
    });
    if (nativeResult.installed && client === "vscode" && previousVsix?.contents) {
      rollback.push(async () => {
        const code = options.codePath ?? (process.platform === "win32" ? "code.cmd" : "code");
        if (options.nativeCommandRunner) await options.nativeCommandRunner(code, ["--install-extension", previousVsix!.path], pluginSrc);
        else execFileSync(code, ["--install-extension", previousVsix!.path], { cwd: pluginSrc });
      });
    }
    if (nativeResult.installed && client === "intellij" && nativeResult.pluginsDir) {
      const pluginsDir = nativeResult.pluginsDir;
      rollback.push(() => restoreIntellijPlugin(pluginsDir));
    }
  }

  const code = await runInstallerSetup("all", {
    argv: setup.argv,
    probe: setup.probe,
    noLogin,
    prompt: setup.prompt,
    interactive: setup.interactive,
  });
  if (code !== 0) return code;

  const health = await verifyInstall({ client, cursorDest: pluginDest, mcpJsonPath });
  const failed = health.filter((c) => !c.ok);
  if (failed.length) {
    throw new Error(
      `install verify failed: ${failed.map((f) => f.name).join(", ")} (${JSON.stringify(failed.map((f) => f.detail))})`,
    );
  }

  let cleanup: CleanupResult = { removed: [] };
  try {
    cleanup = await cleanupAfterInstall(options, pluginDest, nativeResult);
  } catch (error) {
    console.error(`install: warning: old-version cleanup failed: ${String(error)}`);
  }
  console.log(nextSteps({ client, pluginDest, pluginSrc, nativeResult }));
  if (cleanup.backupDir) console.log(`Moved older plugin files to ${cleanup.backupDir}`);
  return 0;
}

function flagValue(argv: string[], name: string): string | undefined {
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === name) {
      const v = (argv[i + 1] ?? "").trim();
      return v && !v.startsWith("-") ? v : undefined;
    }
    if (arg.startsWith(`${name}=`)) {
      return arg.slice(name.length + 1).trim() || undefined;
    }
  }
  return undefined;
}
