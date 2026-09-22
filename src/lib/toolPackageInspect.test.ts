import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inflateRawSync } from "node:zlib";
import { buildZip } from "./zipArchive.js";
import {
  buildToolPackageArchive,
  inspectCommandMcpCodebase,
  toolKeyFromDirName,
} from "./toolPackageInspect.js";

function unzipNames(buf: Buffer): string[] {
  const names: string[] = [];
  let offset = 0;
  while (offset + 4 <= buf.length) {
    const sig = buf.readUInt32LE(offset);
    if (sig !== 0x04034b50) break;
    const nameLen = buf.readUInt16LE(offset + 26);
    const extraLen = buf.readUInt16LE(offset + 28);
    const compSize = buf.readUInt32LE(offset + 18);
    const name = buf.subarray(offset + 30, offset + 30 + nameLen).toString("utf8");
    names.push(name);
    offset += 30 + nameLen + extraLen + compSize;
  }
  return names;
}

function unzipFile(buf: Buffer, want: string): Buffer {
  let offset = 0;
  while (offset + 4 <= buf.length) {
    const sig = buf.readUInt32LE(offset);
    if (sig !== 0x04034b50) break;
    const nameLen = buf.readUInt16LE(offset + 26);
    const extraLen = buf.readUInt16LE(offset + 28);
    const compSize = buf.readUInt32LE(offset + 18);
    const name = buf.subarray(offset + 30, offset + 30 + nameLen).toString("utf8");
    const dataStart = offset + 30 + nameLen + extraLen;
    const data = buf.subarray(dataStart, dataStart + compSize);
    if (name === want) return inflateRawSync(data);
    offset = dataStart + compSize;
  }
  throw new Error(`missing zip entry ${want}`);
}

test("toolKeyFromDirName strips mcp-service suffix", () => {
  assert.equal(toolKeyFromDirName("sap-gui-mcp-service"), "sap-gui.mcp");
  assert.equal(toolKeyFromDirName("spa-credentials-dummy-mcp-service"), "spa-credentials-dummy.mcp");
});

test("inspect python command MCP infers launch + env and skips venv", () => {
  const dir = mkdtempSync(join(tmpdir(), "yaaif-pkg-py-"));
  writeFileSync(join(dir, "pyproject.toml"), [
    "[project]",
    'name = "demo-gui-mcp-service"',
    'version = "2.3.0"',
    'description = "Demo GUI automation."',
    "",
    "[project.scripts]",
    'demo-gui-mcp-server = "demo_gui_mcp_service.main:main"',
    "",
  ].join("\n"));
  writeFileSync(join(dir, ".env.example"), [
    "SERVICE_NAME=demo-gui-mcp-service",
    "DESKTOP_WORKER_LOG_DIR=/tmp",
    "LEASE_RUN_ID=",
    "LOG_LEVEL=INFO",
    "",
  ].join("\n"));
  mkdirSync(join(dir, "src", "demo_gui_mcp_service"), { recursive: true });
  writeFileSync(join(dir, "src", "demo_gui_mcp_service", "main.py"), "def main():\n    pass\n");
  mkdirSync(join(dir, ".venv", "lib"), { recursive: true });
  writeFileSync(join(dir, ".venv", "lib", "x.py"), "# skip\n");
  writeFileSync(join(dir, ".env"), "SECRET=nope\n");

  const inspected = inspectCommandMcpCodebase({ source_dir: dir, platform: "windows" });
  assert.equal(inspected.language, "python");
  assert.equal(inspected.launch.tool_key, "demo-gui.mcp");
  assert.equal(inspected.launch.version, "2.3.0");
  assert.equal(inspected.launch.interpreter, "python");
  assert.equal(inspected.launch.env_template.LOG_LEVEL, "INFO");
  assert.equal(inspected.launch.env_template.SERVICE_NAME, "demo-gui-mcp-service");
  assert.equal("DESKTOP_WORKER_LOG_DIR" in inspected.launch.env_template, false);
  assert.equal(inspected.artifact.platform, "windows");
  assert.equal(inspected.artifact.entrypoint, "src/demo_gui_mcp_service/main.py");
  assert.match(inspected.warnings.join(" "), /bundled executable/);

  const archive = buildToolPackageArchive(inspected);
  const names = unzipNames(archive.buffer);
  assert.ok(names.includes("src/demo_gui_mcp_service/main.py"));
  assert.ok(names.includes("pyproject.toml"));
  assert.equal(names.some((n) => n.includes(".venv")), false);
  assert.equal(names.includes(".env"), false);
  assert.equal(unzipFile(archive.buffer, "pyproject.toml").toString("utf8").includes("demo-gui-mcp-service"), true);
});

test("inspect wraps a dist exe and uses empty interpreter", () => {
  const dir = mkdtempSync(join(tmpdir(), "yaaif-pkg-exe-"));
  writeFileSync(join(dir, "pyproject.toml"), 'name = "sap-gui-mcp-service"\nversion = "1.4.0"\n');
  mkdirSync(join(dir, "dist"));
  writeFileSync(join(dir, "dist", "sap-gui-mcp-stdio.exe"), Buffer.from("MZ-fake-exe"));

  const inspected = inspectCommandMcpCodebase({ source_dir: dir });
  assert.equal(inspected.artifact.source, "dist-binary");
  assert.equal(inspected.artifact.platform, "windows");
  assert.equal(inspected.artifact.entrypoint, "sap-gui-mcp-stdio.exe");
  assert.equal(inspected.launch.interpreter, "");

  const archive = buildToolPackageArchive(inspected);
  assert.deepEqual(unzipNames(archive.buffer), ["sap-gui-mcp-stdio.exe"]);
  assert.equal(unzipFile(archive.buffer, "sap-gui-mcp-stdio.exe").toString("utf8"), "MZ-fake-exe");
});

test("manifest yaaif-tool-package.json wins over inferred fields", () => {
  const dir = mkdtempSync(join(tmpdir(), "yaaif-pkg-man-"));
  writeFileSync(join(dir, "stdio-server.js"), "console.log('ok')\n");
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "other", version: "0.0.1" }));
  writeFileSync(join(dir, "yaaif-tool-package.json"), JSON.stringify({
    tool_key: "spa.credentials.debug.mcp",
    version: "9.9.9",
    display_name: "SPA Credentials Debug",
    interpreter: "node",
    entrypoint: "stdio-server.js",
    platform: "macos",
  }));

  const inspected = inspectCommandMcpCodebase({ source_dir: dir });
  assert.equal(inspected.launch.tool_key, "spa.credentials.debug.mcp");
  assert.equal(inspected.launch.version, "9.9.9");
  assert.equal(inspected.launch.interpreter, "node");
  assert.equal(inspected.artifact.platform, "macos");
  assert.equal(inspected.artifact.entrypoint, "stdio-server.js");
});

test("buildZip round-trips utf8 content", () => {
  const zip = buildZip([{ name: "readme.txt", data: Buffer.from("hello zip") }]);
  assert.equal(unzipFile(zip, "readme.txt").toString("utf8"), "hello zip");
});
