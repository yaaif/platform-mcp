import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, extname, join, relative, resolve, sep } from "node:path";
import { buildZip } from "./zipArchive.js";
export const TOOL_PACKAGE_PLATFORMS = ["windows", "macos", "linux"];
const MANIFEST_NAMES = ["yaaif-tool-package.json", "yaaif-package.json"];
const SKIP_ENV_KEYS = new Set([
    "DESKTOP_WORKER_LOG_DIR",
    "LEASE_RUN_ID",
]);
const SKIP_DIR_NAMES = new Set([
    ".git",
    ".hg",
    ".svn",
    ".venv",
    "venv",
    "node_modules",
    "__pycache__",
    ".pytest_cache",
    ".mypy_cache",
    ".ruff_cache",
    ".tox",
    ".idea",
    ".vscode",
    "coverage",
    "htmlcov",
    "target",
    "vendor",
    "dist",
]);
const SKIP_FILE_NAMES = new Set([".ds_store", ".env", ".env.local", ".env.production"]);
export function normalizeToolPackagePlatform(raw) {
    switch ((raw || "").trim().toLowerCase()) {
        case "windows":
        case "win":
        case "win32":
        case "win64":
            return "windows";
        case "macos":
        case "mac":
        case "darwin":
        case "osx":
            return "macos";
        case "linux":
        case "ubuntu":
        case "debian":
            return "linux";
        default:
            return "";
    }
}
export function hostPlatform() {
    if (process.platform === "win32")
        return "windows";
    if (process.platform === "darwin")
        return "macos";
    return "linux";
}
export function toolKeyFromDirName(dirName) {
    let name = dirName.trim().toLowerCase();
    name = name.replace(/-mcp-service$/, "").replace(/-mcp$/, "");
    name = name.replace(/[^a-z0-9._-]+/g, "-").replace(/^[-.]+|[-.]+$/g, "");
    if (!name)
        return "tool.mcp";
    return name.endsWith(".mcp") ? name : `${name}.mcp`;
}
export function inspectCommandMcpCodebase(input) {
    const sourceDir = resolve(input.source_dir);
    if (!existsSync(sourceDir) || !statSync(sourceDir).isDirectory()) {
        throw new Error(`source_dir is not a directory: ${sourceDir}`);
    }
    const warnings = [];
    const manifest = readManifest(sourceDir);
    const language = detectLanguage(sourceDir);
    const py = language === "python" ? parsePyproject(join(sourceDir, "pyproject.toml")) : null;
    const pkg = language === "node" ? parsePackageJson(join(sourceDir, "package.json")) : null;
    const envTemplate = {
        ...envFromExample(join(sourceDir, ".env.example")),
        ...(manifest?.env_template ?? {}),
        ...(input.env_template ?? {}),
    };
    const inferredKey = toolKeyFromDirName(py?.name || pkg?.name || basename(sourceDir));
    const toolKey = (input.tool_key || manifest?.tool_key || inferredKey).trim().toLowerCase();
    const version = (input.version || manifest?.version || py?.version || pkg?.version || "1.0.0").trim() || "1.0.0";
    const displayName = (input.display_name || manifest?.display_name || humanizeName(py?.name || pkg?.name || inferredKey)).trim();
    const description = (input.description ||
        manifest?.description ||
        py?.description ||
        pkg?.description ||
        `Command-based MCP package ${toolKey}`).trim();
    const artifactPath = firstExisting(input.artifact_path ? resolve(sourceDir, input.artifact_path) : "", manifest?.artifact ? resolve(sourceDir, manifest.artifact) : "", ...distBinaries(sourceDir));
    let interpreter = (input.interpreter ?? manifest?.interpreter ?? "").trim();
    let commandArgs = input.command_args ?? manifest?.command_args ?? [];
    let entrypoint = (input.entrypoint || manifest?.entrypoint || "").trim();
    let platform = (normalizeToolPackagePlatform(input.platform) ||
        normalizeToolPackagePlatform(manifest?.platform));
    let source = "source-tree";
    const artifactWarnings = [];
    if (artifactPath) {
        source = input.artifact_path ? "artifact_path" : manifest?.artifact ? "manifest" : "dist-binary";
        const ext = extname(artifactPath).toLowerCase();
        if (!entrypoint)
            entrypoint = basename(artifactPath);
        if (ext === ".exe" || ext === ".bat" || ext === ".cmd") {
            if (!platform)
                platform = "windows";
            if (!input.interpreter && manifest?.interpreter == null)
                interpreter = "";
            commandArgs = input.command_args ?? manifest?.command_args ?? [];
        }
        else if (ext === ".js" || ext === ".mjs" || ext === ".cjs") {
            if (!interpreter)
                interpreter = "node";
        }
    }
    else if (language === "node") {
        if (!interpreter)
            interpreter = "node";
        if (!entrypoint) {
            entrypoint = firstExistingRel(sourceDir, [
                "stdio-server.js",
                "stdio.js",
                pkg?.bin || "",
                pkg?.main || "",
                "index.js",
                "src/index.js",
            ]);
        }
        if (!entrypoint) {
            warnings.push("No Node stdio entrypoint found (stdio-server.js / package.json bin).");
        }
    }
    else if (language === "python") {
        if (!interpreter)
            interpreter = "python";
        if (!entrypoint) {
            entrypoint = firstExistingRel(sourceDir, [
                py?.scriptModule ? pyprojectScriptPath(sourceDir, py.scriptModule) : "",
                ...pythonEntryCandidates(sourceDir),
            ]);
        }
        artifactWarnings.push("No bundled executable found under dist/. Source archives require Python on the desktop worker. Prefer a PyInstaller/standalone exe for Windows SAP GUI tools.");
    }
    else if (language === "go") {
        artifactWarnings.push("Go command MCP packages should ship a prebuilt binary (pass artifact_path or put it in dist/).");
    }
    else {
        warnings.push("Could not detect python/node/go layout; packaging the source tree as-is.");
    }
    if (!platform) {
        platform = entrypoint.toLowerCase().endsWith(".exe") ? "windows" : hostPlatform();
    }
    const resolvedPlatform = platform || hostPlatform();
    const files = listPackableFiles(sourceDir, { includeDist: source !== "source-tree" && Boolean(artifactPath) });
    if (source === "source-tree" && files.length === 0) {
        throw new Error(`no packable files under ${sourceDir}`);
    }
    const detectedGit = detectGitProvenance(sourceDir);
    const launch = {
        tool_key: toolKey,
        version,
        display_name: displayName,
        description,
        interpreter,
        command_args: commandArgs.filter((v) => String(v).trim()),
        env_template: envTemplate,
        capabilities: (input.capabilities ?? manifest?.capabilities ?? ["mcp"]).filter((v) => String(v).trim()),
        timeout_seconds: input.timeout_seconds ?? manifest?.timeout_seconds ?? 60,
        git_remote_url: (input.git_remote_url ?? "").trim() ||
            (manifest?.git_remote_url ?? "").trim() ||
            detectedGit.remoteURL ||
            undefined,
        git_commit_sha: (input.git_commit_sha ?? "").trim() ||
            (manifest?.git_commit_sha ?? "").trim() ||
            detectedGit.commitSHA ||
            undefined,
    };
    return {
        source_dir: sourceDir,
        language,
        kind: "command_mcp",
        launch,
        artifact: {
            platform: resolvedPlatform,
            archive_format: archiveFormatFor(artifactPath),
            entrypoint,
            source,
            wrap_file: artifactPath || undefined,
            warnings: artifactWarnings,
        },
        file_count: source === "source-tree" ? files.length : 1,
        warnings: [...warnings, ...artifactWarnings],
        manifest_path: manifestPath(sourceDir),
    };
}
export function buildToolPackageArchive(inspected) {
    const wrap = inspected.artifact.wrap_file;
    const platform = inspected.artifact.platform;
    const key = inspected.launch.tool_key || "tool-package";
    if (wrap && existsSync(wrap) && statSync(wrap).isFile()) {
        const ext = extname(wrap).toLowerCase();
        if (ext === ".zip" || ext === ".tar" || wrap.toLowerCase().endsWith(".tar.gz") || ext === ".tgz") {
            const format = archiveFormatFor(wrap);
            return {
                buffer: readFileSync(wrap),
                file_name: basename(wrap),
                content_type: format === "zip" ? "application/zip" : "application/gzip",
                archive_format: format,
                entrypoint: inspected.artifact.entrypoint || basename(wrap),
                platform,
                file_count: 1,
            };
        }
        const name = inspected.artifact.entrypoint || basename(wrap);
        const zip = buildZip([{ name, data: readFileSync(wrap) }]);
        return {
            buffer: zip,
            file_name: `${key}-${platform}.zip`,
            content_type: "application/zip",
            archive_format: "zip",
            entrypoint: name,
            platform,
            file_count: 1,
        };
    }
    const files = listPackableFiles(inspected.source_dir, { includeDist: false });
    const entries = files.map((rel) => ({
        name: rel,
        data: readFileSync(join(inspected.source_dir, rel)),
    }));
    return {
        buffer: buildZip(entries),
        file_name: `${key}-${platform}.zip`,
        content_type: "application/zip",
        archive_format: "zip",
        entrypoint: inspected.artifact.entrypoint,
        platform,
        file_count: files.length,
    };
}
export function encodeMultipart(fields, file) {
    const boundary = `----yaaifToolPackage${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`;
    const chunks = [];
    for (const [name, value] of Object.entries(fields)) {
        if (value == null)
            continue;
        chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${escapeDisp(name)}"\r\n\r\n${value}\r\n`));
    }
    const filename = basename(file.filename).replace(/[\r\n"]/g, "_");
    const ctype = file.contentType || "application/octet-stream";
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${escapeDisp(file.field)}"; filename="${escapeDisp(filename)}"\r\nContent-Type: ${ctype}\r\n\r\n`));
    chunks.push(file.body);
    chunks.push(Buffer.from(`\r\n--${boundary}--\r\n`));
    return { buffer: Buffer.concat(chunks), contentType: `multipart/form-data; boundary=${boundary}` };
}
function escapeDisp(value) {
    return value.replace(/[\r\n"]/g, "_");
}
function archiveFormatFor(path) {
    const lower = (path || "").toLowerCase();
    if (lower.endsWith(".tar.gz") || lower.endsWith(".tgz"))
        return "tar.gz";
    if (lower.endsWith(".tar"))
        return "tar";
    return "zip";
}
function readManifest(dir) {
    const path = manifestPath(dir);
    if (!path)
        return null;
    try {
        const parsed = JSON.parse(readFileSync(path, "utf8"));
        return parsed && typeof parsed === "object" ? parsed : null;
    }
    catch {
        throw new Error(`invalid JSON in ${path}`);
    }
}
function manifestPath(dir) {
    for (const name of MANIFEST_NAMES) {
        const path = join(dir, name);
        if (existsSync(path) && statSync(path).isFile())
            return path;
    }
    return null;
}
function detectLanguage(dir) {
    if (existsSync(join(dir, "pyproject.toml")) || existsSync(join(dir, "requirements.txt")))
        return "python";
    if (existsSync(join(dir, "package.json")))
        return "node";
    if (existsSync(join(dir, "go.mod")))
        return "go";
    if (distBinaries(dir).length)
        return "binary";
    return "unknown";
}
function distBinaries(dir) {
    const dist = join(dir, "dist");
    if (!existsSync(dist) || !statSync(dist).isDirectory())
        return [];
    const names = readdirSync(dist);
    const ranked = names
        .filter((n) => /\.(exe|bin)$/i.test(n) || /(stdio|mcp)/i.test(n))
        .map((n) => join(dist, n))
        .filter((p) => statSync(p).isFile());
    const exes = ranked.filter((p) => p.toLowerCase().endsWith(".exe"));
    return exes.length ? exes : ranked;
}
function parsePyproject(path) {
    if (!existsSync(path))
        return null;
    const text = readFileSync(path, "utf8");
    const field = (key) => {
        const m = text.match(new RegExp(`^${key}\\s*=\\s*["']([^"']+)["']`, "m"));
        return m?.[1];
    };
    let scriptModule;
    const scripts = text.split("[project.scripts]")[1]?.split("\n[")[0] ?? "";
    const scriptLine = scripts.split("\n").map((l) => l.trim()).find((l) => l.includes("=") && !l.startsWith("#"));
    if (scriptLine) {
        const rhs = scriptLine.split("=")[1]?.replace(/["']/g, "").trim() ?? "";
        scriptModule = rhs.split(":")[0]?.trim();
    }
    return {
        name: field("name"),
        version: field("version"),
        description: field("description"),
        scriptModule,
    };
}
function parsePackageJson(path) {
    if (!existsSync(path))
        return null;
    try {
        const json = JSON.parse(readFileSync(path, "utf8"));
        const bin = typeof json.bin === "string"
            ? json.bin
            : json.bin
                ? Object.values(json.bin)[0]
                : undefined;
        return { name: json.name, version: json.version, description: json.description, bin, main: json.main };
    }
    catch {
        return null;
    }
}
function pyprojectScriptPath(dir, moduleName) {
    const dotted = moduleName.replace(/\./g, sep);
    return firstExistingRel(dir, [
        join("src", dotted, "main.py"),
        join("src", `${dotted}.py`),
        join(dotted, "main.py"),
        `${dotted}.py`,
    ]);
}
function pythonEntryCandidates(dir) {
    const src = join(dir, "src");
    const out = [];
    if (existsSync(src) && statSync(src).isDirectory()) {
        for (const name of readdirSync(src)) {
            const pkg = join(src, name);
            if (statSync(pkg).isDirectory()) {
                if (existsSync(join(pkg, "main.py")))
                    out.push(join("src", name, "main.py"));
                if (existsSync(join(pkg, "__main__.py")))
                    out.push(join("src", name, "__main__.py"));
            }
        }
    }
    return out;
}
function envFromExample(path) {
    if (!existsSync(path))
        return {};
    const env = {};
    for (const raw of readFileSync(path, "utf8").split(/\r?\n/)) {
        const line = raw.trim();
        if (!line || line.startsWith("#"))
            continue;
        const idx = line.indexOf("=");
        if (idx <= 0)
            continue;
        const key = line.slice(0, idx).trim();
        if (!key || SKIP_ENV_KEYS.has(key))
            continue;
        env[key] = line.slice(idx + 1).trim();
    }
    return env;
}
function humanizeName(raw) {
    const base = raw.replace(/-mcp-service$/i, "").replace(/-mcp$/i, "").replace(/\.mcp$/i, "");
    const words = base.split(/[-._/]+/).filter(Boolean).map((w) => {
        const lower = w.toLowerCase();
        if (["sap", "mcp", "gui", "api", "http"].includes(lower))
            return lower.toUpperCase();
        return w.charAt(0).toUpperCase() + w.slice(1);
    });
    const joined = words.join(" ") || "Tool";
    return joined.toLowerCase().endsWith(" mcp") ? joined : `${joined} MCP`;
}
function firstExisting(...paths) {
    for (const p of paths) {
        if (p && existsSync(p) && statSync(p).isFile())
            return p;
    }
    return "";
}
function firstExistingRel(dir, rels) {
    for (const rel of rels) {
        if (!rel)
            continue;
        const abs = resolve(dir, rel);
        if (existsSync(abs) && statSync(abs).isFile()) {
            return relative(dir, abs).split(sep).join("/");
        }
    }
    return "";
}
export function listPackableFiles(dir, opts = {}) {
    const out = [];
    const walk = (current) => {
        let names;
        try {
            names = readdirSync(current);
        }
        catch {
            return;
        }
        for (const name of names) {
            if (SKIP_FILE_NAMES.has(name.toLowerCase()))
                continue;
            if (name.endsWith(".pyc") || name.endsWith(".egg-info"))
                continue;
            const abs = join(current, name);
            let st;
            try {
                st = statSync(abs);
            }
            catch {
                continue;
            }
            if (st.isDirectory()) {
                if (SKIP_DIR_NAMES.has(name) && !(opts.includeDist && name === "dist"))
                    continue;
                if (name.endsWith(".egg-info"))
                    continue;
                walk(abs);
                continue;
            }
            if (!st.isFile())
                continue;
            out.push(relative(dir, abs).split(sep).join("/"));
        }
    };
    walk(dir);
    return out.sort();
}
function detectGitProvenance(sourceDir) {
    const run = (args) => {
        try {
            return execFileSync("git", args, {
                cwd: sourceDir,
                encoding: "utf8",
                stdio: ["ignore", "pipe", "ignore"],
                timeout: 3000,
            }).trim();
        }
        catch {
            return "";
        }
    };
    return {
        remoteURL: run(["remote", "get-url", "origin"]),
        commitSHA: run(["rev-parse", "HEAD"]),
    };
}
