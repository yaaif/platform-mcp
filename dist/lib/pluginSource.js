import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { yaaifFetch } from "../client/tls.js";
import { PACKAGE_VERSION } from "../version.js";
const MAX_ARCHIVE_BYTES = 32 * 1024 * 1024;
const MAX_EXTRACTED_BYTES = 64 * 1024 * 1024;
const MAX_ENTRIES = 5000;
const PLUGIN_REPOS = {
    cursor: "cursor-plugin",
    claude: "claude-plugin",
    codex: "codex-plugin",
    vscode: "vscode-plugin",
    intellij: "jetbrains-plugin",
};
export function pluginArchiveUrl(client, ref = `v${PACKAGE_VERSION}`, baseUrl = "https://codeload.github.com/yaaif") {
    const repo = PLUGIN_REPOS[client];
    if (!repo)
        throw new Error(`no source archive installer for ${client}`);
    const encodedRef = ref.split("/").map(encodeURIComponent).join("/");
    return `${baseUrl.replace(/\/+$/, "")}/${repo}/tar.gz/${encodedRef}`;
}
function tarString(block, start, length) {
    return block.toString("utf8", start, start + length).replace(/\0.*$/s, "").trim();
}
function safeRelativePath(path) {
    const parts = path.split("/").filter(Boolean);
    parts.shift();
    if (!parts.length || parts.some((part) => part === ".." || part === "." || part.includes("\\")) || path.startsWith("/")) {
        throw new Error(`unsafe plugin archive path: ${path}`);
    }
    return parts.join("/");
}
export async function extractPluginTarGz(archive, destination) {
    const tar = gunzipSync(archive);
    let offset = 0;
    let entries = 0;
    let extracted = 0;
    let files = 0;
    while (offset + 512 <= tar.length) {
        const header = tar.subarray(offset, offset + 512);
        if (header.every((value) => value === 0))
            break;
        offset += 512;
        const name = tarString(header, 0, 100);
        const prefix = tarString(header, 345, 155);
        const archivePath = prefix ? `${prefix}/${name}` : name;
        const sizeText = tarString(header, 124, 12).replace(/\0/g, "").trim();
        const size = Number.parseInt(sizeText || "0", 8);
        if (!Number.isFinite(size) || size < 0)
            throw new Error(`invalid tar entry size for ${archivePath}`);
        const type = String.fromCharCode(header[156] || 0);
        const body = tar.subarray(offset, offset + size);
        if (body.length !== size)
            throw new Error(`truncated tar entry: ${archivePath}`);
        offset += Math.ceil(size / 512) * 512;
        if (type === "x" || type === "g")
            continue;
        const relative = safeRelativePath(archivePath);
        const output = join(destination, relative);
        if (type === "5") {
            await mkdir(output, { recursive: true, mode: 0o700 });
            continue;
        }
        if (type !== "0" && type !== "\0")
            throw new Error(`unsupported tar entry type ${type} for ${archivePath}`);
        entries += 1;
        files += 1;
        extracted += size;
        if (entries > MAX_ENTRIES || extracted > MAX_EXTRACTED_BYTES)
            throw new Error("plugin archive extraction limit exceeded");
        await mkdir(join(output, ".."), { recursive: true, mode: 0o700 });
        await writeFile(output, body, { mode: 0o600 });
    }
    if (!files)
        throw new Error("plugin archive contained no regular files");
}
export async function downloadPluginSource(options) {
    const ref = options.ref?.trim() || `v${PACKAGE_VERSION}`;
    const url = pluginArchiveUrl(options.client, ref, options.baseUrl);
    const fetchImpl = options.fetchImpl ?? yaaifFetch;
    const response = await fetchImpl(url, { timeoutMs: 60_000 });
    if (!response.ok)
        throw new Error(`plugin source download failed (${response.status}) for ${url}`);
    const declared = Number(response.headers.get("content-length") ?? 0);
    if (declared > MAX_ARCHIVE_BYTES)
        throw new Error("plugin archive exceeds the 32 MiB download limit");
    const archive = Buffer.from(await response.arrayBuffer());
    if (archive.length > MAX_ARCHIVE_BYTES)
        throw new Error("plugin archive exceeds the 32 MiB download limit");
    if (options.sha256) {
        const expected = options.sha256.trim().toLowerCase();
        if (!/^[a-f0-9]{64}$/.test(expected))
            throw new Error("--plugin-sha256 must be a 64-character hexadecimal SHA-256 digest");
        const actual = createHash("sha256").update(archive).digest("hex");
        if (actual !== expected)
            throw new Error(`plugin archive SHA-256 mismatch: expected ${expected}, got ${actual}`);
    }
    const temporary = await mkdtemp(join(tmpdir(), `yaaif-${options.client}-source-`));
    try {
        await extractPluginTarGz(archive, temporary);
        return {
            path: temporary,
            cleanup: async () => { await rm(temporary, { recursive: true, force: true }); },
        };
    }
    catch (error) {
        await rm(temporary, { recursive: true, force: true });
        throw error;
    }
}
