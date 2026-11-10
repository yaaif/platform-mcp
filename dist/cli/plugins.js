import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { collectInstallHealth, cursorPluginDest, readPluginVersion, resolveMcpJsonPath, runInstall, verifyInstall, } from "../lib/pluginInstall.js";
const execFileAsync = promisify(execFile);
export const PLUGIN_CLIENTS = ["cursor", "claude", "codex", "vscode", "intellij", "opencode"];
export async function loadPluginContract() {
    const path = fileURLToPath(new URL("../../plugin-contract.json", import.meta.url));
    return JSON.parse(await readFile(path, "utf8"));
}
export function nativeUpdateInstruction(client) {
    switch (client) {
        case "cursor": return "Cursor → Plugins → yaaif → Update, then reload the window.";
        case "claude": return "Update yaaif-platform from the yaaif Claude marketplace, then start a new session.";
        case "codex": return "Update yaaif-platform from the configured Codex marketplace, then start a new task.";
        case "vscode": return "Update YAAIF Platform from the VS Code Extensions view, then reload the window.";
        case "intellij": return "Update YAAIF Platform from JetBrains Marketplace, then restart the IDE.";
        case "opencode": return "Redeploy the YAAIF OpenCode sidecar with the desired platform-mcp image/package.";
    }
}
export async function pluginCatalog() {
    const contract = await loadPluginContract();
    return PLUGIN_CLIENTS.map((client) => ({
        client,
        plugin_version: contract.pluginVersions[client] ?? null,
        mcp_package: contract.mcpPackage,
        native_update: nativeUpdateInstruction(client),
    }));
}
async function readJson(path) {
    return JSON.parse(await readFile(path, "utf8"));
}
async function sourceVersion(client, root) {
    if (client === "cursor")
        return readPluginVersion(root);
    if (client === "claude") {
        return String((await readJson(join(root, ".claude-plugin", "plugin.json"))).version ?? "");
    }
    if (client === "codex") {
        return String((await readJson(join(root, "plugins", "yaaif-platform", ".codex-plugin", "plugin.json"))).version ?? "");
    }
    if (client === "vscode")
        return String((await readJson(join(root, "package.json"))).version ?? "");
    if (client === "intellij") {
        const text = await readFile(join(root, "build.gradle.kts"), "utf8");
        return text.match(/^version\s*=\s*"([^"]+)"/m)?.[1] ?? "";
    }
    return "";
}
async function sourcePin(client, root) {
    let path = "";
    if (client === "vscode")
        path = join(root, "src", "extension.ts");
    if (client === "intellij")
        path = join(root, "src", "main", "kotlin", "ai", "yaaif", "jetbrains", "ConfigureMcpBridgeAction.kt");
    if (!path || !existsSync(path))
        return "";
    const text = await readFile(path, "utf8");
    return text.match(/@yaaif\/platform-mcp@[0-9]+\.[0-9]+\.[0-9]+/)?.[0] ?? "";
}
export async function checkPlugin(options) {
    const contract = await loadPluginContract();
    const root = options.pluginSrc
        ? resolve(options.pluginSrc)
        : options.client === "cursor" ? cursorPluginDest() : undefined;
    const checks = [];
    let version = "";
    let mcpPackage = "";
    if (options.client === "opencode") {
        checks.push({
            name: "deployment_model",
            ok: true,
            detail: { managed_by: "YAAIF OpenCode sidecar", update: nativeUpdateInstruction(options.client) },
        });
        checks.push(...collectInstallHealth({ client: options.client }));
    }
    else if (root && existsSync(root)) {
        version = await sourceVersion(options.client, root);
        checks.push({
            name: "plugin_version",
            ok: version === contract.pluginVersions[options.client],
            detail: { actual: version || "unknown", expected: contract.pluginVersions[options.client] ?? null },
        });
        if (["cursor", "claude", "codex"].includes(options.client)) {
            const mcpPath = resolveMcpJsonPath(options.client, root);
            const mcp = await readJson(mcpPath);
            const entry = mcp.mcpServers?.yaaif;
            mcpPackage = entry?.args?.find((arg) => arg.startsWith("@yaaif/platform-mcp@")) ?? "";
            checks.push({
                name: "mcp_package_pin",
                ok: mcpPackage === contract.mcpPackage || (options.client === "cursor" && Boolean(entry?.command && entry.command !== "npx")),
                detail: { actual: mcpPackage || "absolute/offline launch", expected: contract.mcpPackage },
            });
            if (options.client === "cursor")
                checks.push(...await verifyInstall({ client: options.client, cursorDest: root }));
            else
                checks.push(...collectInstallHealth({ client: options.client, mcpJsonPath: mcpPath }));
        }
        else if (options.client === "vscode" || options.client === "intellij") {
            mcpPackage = await sourcePin(options.client, root);
            checks.push({ name: "mcp_package_pin", ok: mcpPackage === contract.mcpPackage, detail: { actual: mcpPackage, expected: contract.mcpPackage } });
            checks.push(...collectInstallHealth({ client: options.client }));
        }
    }
    else {
        checks.push({
            name: "plugin_source",
            ok: false,
            detail: { path: root ?? null, hint: "Pass --plugin-src DIR for this client, or update through the native marketplace." },
        });
    }
    let latest;
    if (options.online) {
        try {
            latest = (await execFileAsync("npm", ["view", "@yaaif/platform-mcp", "version"], { timeout: 20_000 })).stdout.trim();
            checks.push({ name: "npm_latest", ok: latest === contract.bridgeVersion, detail: { latest, prepared: contract.bridgeVersion } });
        }
        catch (error) {
            checks.push({ name: "npm_latest", ok: false, detail: { error: String(error) } });
        }
    }
    return {
        client: options.client,
        ok: checks.every((check) => check.ok),
        checks,
        version,
        expected_version: contract.pluginVersions[options.client],
        mcp_package: mcpPackage,
        latest_npm_version: latest,
        native_update: nativeUpdateInstruction(options.client),
    };
}
export async function installOrUpdatePlugin(action, client, argv) {
    const sourceIndex = argv.findIndex((arg) => arg === "--plugin-src" || arg.startsWith("--plugin-src="));
    const sourcePath = sourceIndex < 0
        ? undefined
        : argv[sourceIndex] === "--plugin-src" ? argv[sourceIndex + 1] : argv[sourceIndex].slice("--plugin-src=".length);
    const hasSource = sourceIndex >= 0;
    const dryRun = argv.includes("--dry-run");
    if (hasSource && !sourcePath)
        throw new Error("--plugin-src requires a directory");
    if (action === "update" && client === "opencode" && !dryRun) {
        const result = sourcePath ? await checkPlugin({ client, pluginSrc: sourcePath }) : undefined;
        process.stdout.write(`${JSON.stringify({ client, updated: false, source_check: result, native_update_required: true, instructions: nativeUpdateInstruction(client) }, null, 2)}\n`);
        return result && !result.ok ? 1 : 0;
    }
    if (action === "update" && (client === "claude" || client === "codex") && !hasSource && !dryRun) {
        process.stdout.write(`${JSON.stringify({ client, updated: false, native_update_required: true, instructions: nativeUpdateInstruction(client) }, null, 2)}\n`);
        return 0;
    }
    const forwarded = ["--client", client, ...argv];
    if (action === "update" && !forwarded.includes("--no-login"))
        forwarded.push("--no-login");
    return await runInstall({ argv: forwarded });
}
