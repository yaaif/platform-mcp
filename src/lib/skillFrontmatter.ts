/** Minimal SKILL.md frontmatter tool extraction (no YAML dependency). */

export function extractFrontmatterBlock(markdown: string): string {
  const m = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  return m?.[1] ?? "";
}

function parseYamlStringList(block: string, keys: string[]): string[] {
  const lines = block.split(/\r?\n/);
  const keySet = new Set(keys.map((k) => k.toLowerCase()));
  const out: string[] = [];
  let inList = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const keyMatch = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
    if (keyMatch) {
      const key = keyMatch[1].toLowerCase();
      const rest = keyMatch[2].trim();
      if (!keySet.has(key)) {
        inList = false;
        continue;
      }
      if (rest.startsWith("[") && rest.endsWith("]")) {
        const inner = rest.slice(1, -1);
        for (const part of inner.split(",")) {
          const v = part.trim().replace(/^['"]|['"]$/g, "");
          if (v) out.push(v);
        }
        inList = false;
        continue;
      }
      if (rest) {
        out.push(rest.replace(/^['"]|['"]$/g, ""));
        inList = false;
        continue;
      }
      inList = true;
      continue;
    }
    if (inList) {
      const item = line.match(/^\s*-\s+(.+)$/);
      if (item) {
        out.push(item[1].trim().replace(/^['"]|['"]$/g, ""));
      } else if (line.trim() === "" || /^\S/.test(line)) {
        inList = false;
      }
    }
  }
  return out;
}

/** Prefer allowed-tools, fall back to tools (platform skillspec parity). */
export function extractSkillToolsFromMarkdown(markdown: string): string[] {
  const block = extractFrontmatterBlock(markdown);
  if (!block) return [];
  const allowed = parseYamlStringList(block, ["allowed-tools", "allowed_tools"]);
  if (allowed.length) return dedupe(allowed);
  return dedupe(parseYamlStringList(block, ["tools"]));
}

function dedupe(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const t = item.trim();
    if (!t) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

export type ToolCheckResult = {
  ok: boolean;
  tools: string[];
  found_local: string[];
  found_mcp: string[];
  missing: string[];
};

export function verifyToolsAgainstCatalogs(
  tools: string[],
  localNames: string[],
  mcpNames: string[],
): ToolCheckResult {
  const localSet = new Set(localNames.map((n) => n.toLowerCase()));
  const mcpSet = new Set(mcpNames.map((n) => n.toLowerCase()));
  const found_local: string[] = [];
  const found_mcp: string[] = [];
  const missing: string[] = [];
  for (const tool of tools) {
    const key = tool.toLowerCase();
    if (localSet.has(key)) {
      found_local.push(tool);
    } else if (mcpSet.has(key)) {
      found_mcp.push(tool);
    } else {
      missing.push(tool);
    }
  }
  return {
    ok: missing.length === 0,
    tools,
    found_local,
    found_mcp,
    missing,
  };
}
