import { chmodSync, existsSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const cli = join(root, "dist", "cli.js");
if (!existsSync(cli)) process.exit(0);

const binDir = join(root, "node_modules", ".bin");
mkdirSync(binDir, { recursive: true });
const target = relative(binDir, cli);
const names = ["yaaif-platform-mcp", "platform-mcp"];

for (const name of names) {
  const dest = join(binDir, name);
  rmSync(dest, { force: true });
  rmSync(`${dest}.cmd`, { force: true });
  rmSync(`${dest}.ps1`, { force: true });
  if (process.platform === "win32") {
    writeFileSync(
      dest,
      `#!/bin/sh\nbasedir=$(cd "$(dirname "$0")" && pwd)\nexec node "$basedir/${target.replace(/\\/g, "/")}" "$@"\n`,
    );
    writeFileSync(`${dest}.cmd`, `@echo off\r\nnode "%~dp0\\${target.replace(/\//g, "\\")}" %*\r\n`);
  } else {
    symlinkSync(target, dest);
  }
  chmodSync(cli, 0o755);
}
