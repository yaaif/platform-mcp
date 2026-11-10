import assert from "node:assert/strict";
import test from "node:test";
import { createServer, type Server } from "node:http";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

function entry(path: string, body: string): Buffer {
  const header = Buffer.alloc(512);
  header.write(path, 0, "utf8");
  header.write("0000644", 100);
  header.write("0000000", 108);
  header.write("0000000", 116);
  header.write(body.length.toString(8).padStart(11, "0"), 124);
  header.write("0", 156);
  header.write("ustar", 257);
  return Buffer.concat([header, Buffer.from(body), Buffer.alloc((512 - body.length % 512) % 512)]);
}

function pluginArchive(): Buffer {
  return gzipSync(Buffer.concat([
    entry("cursor-plugin-1.7.0/.cursor-plugin/plugin.json", '{"name":"yaaif","version":"1.7.0"}\n'),
    entry("cursor-plugin-1.7.0/mcp.json", '{"mcpServers":{}}\n'),
    entry("cursor-plugin-1.7.0/skills/yaaif-auth/SKILL.md", "---\nname: yaaif-auth\n---\n"),
    Buffer.alloc(1024),
  ]));
}

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("missing test server port");
  return address.port;
}

test("npx-style install downloads, verifies and stages matching source and bridge", async () => {
  const archive = pluginArchive();
  const sha256 = createHash("sha256").update(archive).digest("hex");
  const server = createServer((request, response) => {
    if (request.url !== "/cursor-plugin/tar.gz/v1.7.0") {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { "content-type": "application/gzip", "content-length": archive.length });
    response.end(archive);
  });
  const port = await listen(server);
  const home = await mkdtemp(join(tmpdir(), "yaaif-install-download-home-"));
  const dest = await mkdtemp(join(tmpdir(), "yaaif-install-download-dest-"));
  const entrypoint = fileURLToPath(new URL("../cli.ts", import.meta.url));
  try {
    await writeFile(join(home, "active-profile.json"), '{"profile_id":"hosted"}\n');
    const code = await new Promise<number>((resolve, reject) => {
      const child = spawn(process.execPath, [
        "--import", "tsx", entrypoint,
        "--install", "--client", "cursor", "--no-login",
        "--plugin-source-base-url", `http://127.0.0.1:${port}`,
        "--plugin-sha256", sha256,
      ], {
        env: { ...process.env, YAAIF_CURSOR_HOME: home, YAAIF_CURSOR_PLUGIN_DEST: dest },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stderr = "";
      child.stderr.on("data", (chunk) => { stderr += chunk; });
      child.on("error", reject);
      child.on("close", (status) => status === 0 ? resolve(status) : reject(new Error(`installer exited ${status}: ${stderr}`)));
    });
    assert.equal(code, 0);
    assert.match(await readFile(join(dest, ".cursor-plugin", "plugin.json"), "utf8"), /1\.7\.0/);
    const mcp = JSON.parse(await readFile(join(dest, "mcp.json"), "utf8")) as {
      mcpServers: { yaaif: { command: string; args: string[] } };
    };
    assert.equal(mcp.mcpServers.yaaif.command, process.execPath);
    assert.equal(mcp.mcpServers.yaaif.args[0], join(home, "bridge", "yaaif-platform-mcp-1.7.0.mjs"));
    assert.doesNotMatch(mcp.mcpServers.yaaif.args[0], /_npx/);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(home, { recursive: true, force: true });
    await rm(dest, { recursive: true, force: true });
  }
});
