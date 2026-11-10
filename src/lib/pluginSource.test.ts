import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { downloadPluginSource, extractPluginTarGz, pluginArchiveUrl } from "./pluginSource.js";

function entry(path: string, body: string, type = "0"): Buffer {
  const header = Buffer.alloc(512);
  header.write(path, 0, "utf8");
  header.write("0000644", 100);
  header.write("0000000", 108);
  header.write("0000000", 116);
  header.write(body.length.toString(8).padStart(11, "0"), 124);
  header.write(type, 156);
  header.write("ustar", 257);
  return Buffer.concat([header, Buffer.from(body), Buffer.alloc((512 - body.length % 512) % 512)]);
}

function archive(path = "repo/plugin.json", body = '{"version":"1.7.0"}') {
  return gzipSync(Buffer.concat([entry(path, body), Buffer.alloc(1024)]));
}

test("plugin archive URL defaults to the platform-matching tag", () => {
  assert.equal(pluginArchiveUrl("cursor"), "https://codeload.github.com/yaaif/cursor-plugin/tar.gz/v1.7.0");
  assert.equal(pluginArchiveUrl("vscode"), "https://codeload.github.com/yaaif/vscode-plugin/tar.gz/v1.7.0");
  assert.equal(pluginArchiveUrl("intellij"), "https://codeload.github.com/yaaif/jetbrains-plugin/tar.gz/v1.7.0");
  assert.equal(pluginArchiveUrl("claude", "feature/test"), "https://codeload.github.com/yaaif/claude-plugin/tar.gz/feature/test");
});

test("download verifies checksum and extracts regular files", async () => {
  const bytes = archive();
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const downloaded = await downloadPluginSource({
    client: "cursor",
    sha256,
    fetchImpl: async () => new Response(bytes, { status: 200, headers: { "content-length": String(bytes.length) } }),
  });
  try {
    assert.match(await readFile(join(downloaded.path, "plugin.json"), "utf8"), /1\.7\.0/);
  } finally {
    await downloaded.cleanup();
  }
});

test("archive extraction rejects traversal", async () => {
  const destination = await mkdtemp(join(tmpdir(), "yaaif-tar-safe-"));
  try {
    await assert.rejects(() => extractPluginTarGz(archive("repo/../../escape", "bad"), destination), /unsafe plugin archive path/);
  } finally {
    await rm(destination, { recursive: true, force: true });
  }
});

test("download rejects checksum mismatches", async () => {
  const bytes = archive();
  await assert.rejects(() => downloadPluginSource({
    client: "cursor",
    sha256: "0".repeat(64),
    fetchImpl: async () => new Response(bytes, { status: 200 }),
  }), /SHA-256 mismatch/);
});
