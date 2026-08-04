#!/usr/bin/env node
/**
 * Fetch GET /api/local-tools and write a generated reference markdown.
 * Requires authenticated ~/.yaaif/cursor/session.json (or env bearer + tenant).
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pluginRoot = join(__dirname, "../../..");
const outPath = join(pluginRoot, "skills/yaaif-platform-tools/references/local-tools.generated.md");

async function loadSession() {
  const path = join(homedir(), ".yaaif/cursor/session.json");
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return null;
  }
}

async function main() {
  const agentBase = (process.env.YAAIF_AGENT_BASE_URL || "https://platform.yaaif.ai/agent-service").replace(/\/$/, "");
  const sess = await loadSession();
  const token = process.env.YAAIF_ACCESS_TOKEN || sess?.tokens?.access_token;
  const tenant = process.env.YAAIF_DEFAULT_TENANT_ID || sess?.tenant_id;
  if (!token || !tenant) {
    console.error("Need bearer token + tenant (login via yaaif_ensure_session or set YAAIF_ACCESS_TOKEN / YAAIF_DEFAULT_TENANT_ID).");
    process.exit(1);
  }

  const res = await fetch(`${agentBase}/api/local-tools`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "X-Tenant-ID": tenant,
    },
  });
  if (!res.ok) {
    console.error(`GET /api/local-tools failed: ${res.status} ${await res.text()}`);
    process.exit(1);
  }
  const data = await res.json();
  const items = Array.isArray(data.items) ? data.items : [];
  const byFamily = new Map();
  for (const item of items) {
    const family = item.family || "other";
    if (!byFamily.has(family)) byFamily.set(family, []);
    byFamily.get(family).push(item);
  }

  const lines = [
    "# Local tools (generated)",
    "",
    `Generated ${new Date().toISOString()} from \`${agentBase}/api/local-tools\` (tenant ${tenant}).`,
    "",
    `Total: **${items.length}**`,
    "",
  ];
  for (const family of [...byFamily.keys()].sort()) {
    lines.push(`## ${family}`, "");
    lines.push("| Name | Title | Session | Mutating ack |");
    lines.push("|------|-------|---------|--------------|");
    for (const item of byFamily.get(family).sort((a, b) => String(a.name).localeCompare(String(b.name)))) {
      lines.push(
        `| \`${item.name}\` | ${item.title || ""} | ${item.requires_session ? "yes" : ""} | ${item.requires_mutating_ack ? "yes" : ""} |`,
      );
    }
    lines.push("");
  }

  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, lines.join("\n"), "utf8");
  console.log(`Wrote ${outPath} (${items.length} tools)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
