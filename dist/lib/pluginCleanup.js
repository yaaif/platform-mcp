import { cp, mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, join } from "node:path";
function manifestPath(client, root) {
    if (client === "cursor")
        return join(root, ".cursor-plugin", "plugin.json");
    if (client === "claude")
        return join(root, ".claude-plugin", "plugin.json");
    if (client === "codex")
        return join(root, ".codex-plugin", "plugin.json");
    if (client === "vscode")
        return join(root, "package.json");
    return join(root, "build.gradle.kts");
}
export async function readInstalledVersion(client, root) {
    const path = manifestPath(client, root);
    if (client === "intellij") {
        const text = await readFile(path, "utf8");
        return text.match(/^version\s*=\s*"([^"]+)"/m)?.[1] ?? "";
    }
    const document = JSON.parse(await readFile(path, "utf8"));
    return String(document.version ?? "").trim();
}
export async function retirePluginPaths(paths, backupRoot) {
    const existing = paths.filter((path) => existsSync(path));
    if (!existing.length)
        return { removed: [] };
    await mkdir(backupRoot, { recursive: true, mode: 0o700 });
    const backupDir = await mkdtemp(join(backupRoot, "plugin-cleanup-"));
    const removed = [];
    for (const path of existing) {
        await cp(path, join(backupDir, basename(path)), { recursive: true });
        await rm(path, { recursive: true, force: true });
        removed.push(path);
    }
    return { removed, backupDir };
}
export async function cleanupVersionedCache(options) {
    const currentRoot = join(options.cacheRoot, options.currentVersion);
    if (!existsSync(currentRoot))
        return { removed: [] };
    const entries = await readdir(options.cacheRoot, { withFileTypes: true });
    const old = [];
    for (const entry of entries) {
        if (!entry.isDirectory() || entry.name === options.currentVersion)
            continue;
        const root = join(options.cacheRoot, entry.name);
        try {
            if (await readInstalledVersion(options.client, root))
                old.push(root);
        }
        catch {
            // Only directories with a readable plugin manifest are cleanup candidates.
        }
    }
    return await retirePluginPaths(old, options.backupRoot);
}
