import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { clientDescriptor, loadConfig } from "../config.js";
import { readInstalledVersion } from "./pluginCleanup.js";
import { pluginArchiveUrl } from "./pluginSource.js";
import { stableBridgePath } from "./stableBridge.js";
import { MCP_PACKAGE_PIN, PACKAGE_VERSION } from "../version.js";
import type { InstallOptions } from "./pluginInstall.js";

export type InstallPlan = {
  dry_run: true;
  client: InstallOptions["client"];
  current_version: string | null;
  target_version: string;
  source: { kind: "local" | "download"; location: string; ref?: string; sha256?: string };
  launcher: { kind: "absolute" | "npx"; bridge: string };
  actions: string[];
  native: {
    build_only: boolean;
    code_path?: string;
    gradle_path?: string;
    plugins_dir?: string;
  };
  cleanup: { policy: "preserve" | "backup-and-remove" | "skipped"; backup_root?: string };
};

export async function createInstallPlan(options: InstallOptions): Promise<InstallPlan> {
  const { client } = options;
  const stateHome = loadConfig(clientDescriptor(client)).stateHome;
  const absolute = options.offline || client === "cursor";
  const source: InstallPlan["source"] = options.pluginSrc
    ? { kind: "local", location: options.pluginSrc }
    : client === "opencode"
      ? { kind: "local", location: "YAAIF-managed OpenCode sidecar" }
      : { kind: "download", location: pluginArchiveUrl(client, options.pluginRef, options.pluginSourceBaseUrl), ref: options.pluginRef ?? `v${PACKAGE_VERSION}`, ...(options.pluginSha256 ? { sha256: options.pluginSha256 } : {}) };
  const actions: string[] = [];
  if (source.kind === "download") actions.push(`Download and verify ${source.location}`);
  if (absolute) actions.push(`Stage bundled bridge under ${stableBridgePath(stateHome)}`);
  if (client === "cursor") actions.push("Copy plugin into the local Cursor plugin directory");
  if (client === "claude" || client === "codex") actions.push(`Stage managed source under ${join(stateHome, "plugin")}`);
  if (client === "vscode") {
    actions.push("Run npm ci", "Build yaaif-vscode-1.7.0.vsix with npm run package");
    if (!options.buildOnly) actions.push(`Install the VSIX with ${options.codePath ?? (process.platform === "win32" ? "code.cmd" : "code")} --install-extension`);
  }
  if (client === "intellij") {
    actions.push(`Build yaaif-jetbrains-${PACKAGE_VERSION}-base.jar with ${options.gradlePath ?? "the bundled Gradle wrapper"}`);
    if (!options.buildOnly) actions.push("Install yaaif-jetbrains.jar into the selected IntelliJ plugins directory with a backup");
  }
  actions.push(options.noLogin ? "Validate the existing profile without opening login" : "Configure the platform profile and login");
  const cleanup: InstallPlan["cleanup"] = options.buildOnly
    ? { policy: "skipped" }
    : options.keepOldVersions
      ? { policy: "preserve" }
      : { policy: "backup-and-remove", backup_root: join(stateHome, "plugin-backups") };
  actions.push(cleanup.policy === "backup-and-remove" ? "After verification, move superseded files to backups" : "After verification, preserve old versions");

  let currentVersion: string | null = null;
  try {
    if (client === "cursor") {
      const dest = options.cursorDest ?? (process.env.YAAIF_CURSOR_PLUGIN_DEST?.trim() || join(homedir(), ".cursor", "plugins", "local", "yaaif"));
      if (existsSync(dest)) currentVersion = await readInstalledVersion(client, dest);
    } else if (client === "claude" || client === "codex") {
      const root = options.pluginCacheRoot ?? join(homedir(), `.${client}`, "plugins", "cache", "yaaif", "yaaif-platform", PACKAGE_VERSION);
      if (existsSync(root)) currentVersion = await readInstalledVersion(client, root);
    }
  } catch {
    currentVersion = null;
  }
  return {
    dry_run: true,
    client,
    current_version: currentVersion,
    target_version: PACKAGE_VERSION,
    source,
    launcher: { kind: absolute ? "absolute" : "npx", bridge: absolute ? stableBridgePath(stateHome) : MCP_PACKAGE_PIN },
    actions,
    native: {
      build_only: Boolean(options.buildOnly),
      ...(options.codePath ? { code_path: options.codePath } : {}),
      ...(options.gradlePath ? { gradle_path: options.gradlePath } : {}),
      ...(options.jetbrainsPluginsDir ? { plugins_dir: options.jetbrainsPluginsDir } : {}),
    },
    cleanup,
  };
}
