import { execFile } from "node:child_process";
import { copyFile, mkdir, readdir, rename, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { PACKAGE_VERSION } from "../version.js";
const execFileAsync = promisify(execFile);
async function defaultRunCommand(file, args, cwd) {
    await execFileAsync(file, args, { cwd, maxBuffer: 16 * 1024 * 1024 });
}
function commandError(error, fallback) {
    const code = error.code;
    if (code === "ENOENT")
        return new Error(fallback);
    return error instanceof Error ? error : new Error(String(error));
}
export async function installVsCodePlugin(options) {
    const run = options.runCommand ?? defaultRunCommand;
    const artifactDir = join(options.stateHome, "packages");
    const artifact = join(artifactDir, `yaaif-vscode-${PACKAGE_VERSION}.vsix`);
    await mkdir(artifactDir, { recursive: true, mode: 0o700 });
    await run("npm", ["ci", ...(options.offline ? ["--offline"] : [])], options.sourceDir);
    await run("npm", ["run", "package", "--", "--out", artifact], options.sourceDir);
    if (options.buildOnly)
        return { artifact, installed: false };
    const code = options.codePath ?? (process.platform === "win32" ? "code.cmd" : "code");
    try {
        await run(code, ["--install-extension", artifact], options.sourceDir);
    }
    catch (error) {
        throw commandError(error, `VS Code CLI '${code}' was not found. Install the extension manually from ${artifact}`);
    }
    return { artifact, installed: true };
}
export async function discoverJetBrainsPluginsDir(home = homedir(), platform = process.platform, appData = process.env.APPDATA) {
    const root = platform === "darwin"
        ? join(home, "Library", "Application Support", "JetBrains")
        : platform === "win32"
            ? join(appData ?? join(home, "AppData", "Roaming"), "JetBrains")
            : join(home, ".config", "JetBrains");
    let entries;
    try {
        entries = await readdir(root);
    }
    catch {
        throw new Error(`could not locate a JetBrains configuration under ${root}; pass --jetbrains-plugins-dir`);
    }
    const candidates = [];
    for (const entry of entries) {
        if (!/^(IntelliJIdea|IdeaIC|IntelliJ)/i.test(entry))
            continue;
        const path = join(root, entry, "plugins");
        try {
            const info = await stat(path);
            if (info.isDirectory())
                candidates.push({ path, modified: info.mtimeMs });
        }
        catch {
            // Product directory without a plugins directory is not an install target.
        }
    }
    if (!candidates.length)
        throw new Error(`could not locate an IntelliJ plugins directory under ${root}; pass --jetbrains-plugins-dir`);
    candidates.sort((left, right) => right.modified - left.modified);
    return candidates[0].path;
}
export async function installIntellijPlugin(options) {
    const run = options.runCommand ?? defaultRunCommand;
    const gradle = options.gradlePath ?? join(options.sourceDir, "gradlew");
    if (!existsSync(gradle))
        throw new Error(`Gradle wrapper not found at ${gradle}; pass --gradle-path`);
    await run(gradle, ["build", "--no-daemon", ...(options.offline ? ["--offline"] : [])], options.sourceDir);
    const artifact = join(options.sourceDir, "build", "libs", `yaaif-jetbrains-${PACKAGE_VERSION}-base.jar`);
    if (options.buildOnly)
        return { artifact, installed: false };
    const pluginsDir = options.jetbrainsPluginsDir ?? await discoverJetBrainsPluginsDir();
    await mkdir(pluginsDir, { recursive: true, mode: 0o700 });
    const destination = join(pluginsDir, "yaaif-jetbrains.jar");
    const temporary = join(pluginsDir, "yaaif-jetbrains.jar.tmp");
    if (existsSync(destination))
        await copyFile(destination, join(pluginsDir, "yaaif-jetbrains.jar.backup"));
    await copyFile(artifact, temporary);
    await rename(temporary, destination);
    return { artifact, installed: true, pluginsDir };
}
export async function installNativePlugin(options) {
    if (options.client === "vscode")
        return await installVsCodePlugin(options);
    if (options.client === "intellij")
        return await installIntellijPlugin(options);
    throw new Error(`native installation is not supported for ${options.client}`);
}
