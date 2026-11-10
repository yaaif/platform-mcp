import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PACKAGE_VERSION } from "../version.js";

export function stableBridgePath(stateHome: string): string {
  return join(stateHome, "bridge", `yaaif-platform-mcp-${PACKAGE_VERSION}.mjs`);
}

export function defaultBundledCliPath(fromMetaUrl = import.meta.url): string {
  const candidates = [
    fileURLToPath(new URL("../yaaif-platform-mcp.mjs", fromMetaUrl)),
    fileURLToPath(new URL("../../dist/yaaif-platform-mcp.mjs", fromMetaUrl)),
  ];
  const source = candidates.find((candidate) => existsSync(candidate));
  if (!source) {
    throw new Error("could not resolve the bundled yaaif-platform-mcp.mjs; run npm run build or pass --cli-path");
  }
  return source;
}

export async function stageStableBridge(stateHome: string, source = defaultBundledCliPath()): Promise<string> {
  const destination = stableBridgePath(stateHome);
  const contents = await readFile(source);
  await mkdir(join(stateHome, "bridge"), { recursive: true, mode: 0o700 });
  const temporary = `${destination}.tmp`;
  await writeFile(temporary, contents, { mode: 0o600 });
  await rename(temporary, destination);
  return destination;
}
