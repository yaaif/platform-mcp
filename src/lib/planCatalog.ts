export type PlanExpectations = {
  agent_names?: string[];
  skill_ids?: string[];
  workflow_names?: string[];
  mcp_tool_names?: string[];
  ambient_agent_names?: string[];
};

export type CatalogBuckets = {
  agents: { id?: string; name?: string }[];
  skills: { id?: string; name?: string }[];
  workflows: { id?: string; name?: string }[];
  mcp_tools: { id?: string; name?: string }[];
  ambient_agents: { id?: string; name?: string }[];
};

function asArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if (Array.isArray(obj.items)) return obj.items;
    if (Array.isArray(obj.skills)) return obj.skills;
    if (Array.isArray(obj.agents)) return obj.agents;
    if (Array.isArray(obj.workflows)) return obj.workflows;
    if (Array.isArray(obj.tools)) return obj.tools;
  }
  return [];
}

function nameOf(row: unknown): string {
  if (!row || typeof row !== "object") return "";
  const o = row as Record<string, unknown>;
  return String(o.name ?? o.id ?? "").trim();
}

function idOf(row: unknown): string {
  if (!row || typeof row !== "object") return "";
  const o = row as Record<string, unknown>;
  return String(o.id ?? "").trim();
}

export function extractCatalogBuckets(raw: Record<string, unknown>): CatalogBuckets {
  return {
    agents: asArray(raw.agents).map((r) => ({ id: idOf(r), name: nameOf(r) })),
    skills: asArray(raw.skills).map((r) => ({ id: idOf(r) || nameOf(r), name: nameOf(r) })),
    workflows: asArray(raw.ambient_workflows).map((r) => ({ id: idOf(r), name: nameOf(r) })),
    mcp_tools: asArray(raw.mcp_tools).map((r) => ({ id: idOf(r), name: nameOf(r) })),
    ambient_agents: asArray(raw.ambient_agents).map((r) => ({ id: idOf(r), name: nameOf(r) })),
  };
}

function hasName(rows: { id?: string; name?: string }[], want: string): boolean {
  const target = want.trim().toLowerCase();
  if (!target) return true;
  return rows.some((r) => {
    const n = (r.name || "").toLowerCase();
    const id = (r.id || "").toLowerCase();
    return n === target || id === target || id.endsWith(`/${target}`) || n.includes(target);
  });
}

export function verifyPlanAgainstCatalog(expectations: PlanExpectations, buckets: CatalogBuckets) {
  const missing: Record<string, string[]> = {};
  const found: Record<string, string[]> = {};

  const check = (
    key: keyof PlanExpectations,
    rows: { id?: string; name?: string }[],
  ) => {
    const wants = expectations[key] ?? [];
    for (const want of wants) {
      if (hasName(rows, want)) {
        (found[key] ??= []).push(want);
      } else {
        (missing[key] ??= []).push(want);
      }
    }
  };

  check("agent_names", buckets.agents);
  check("skill_ids", buckets.skills);
  check("workflow_names", buckets.workflows);
  check("mcp_tool_names", buckets.mcp_tools);
  check("ambient_agent_names", buckets.ambient_agents);

  const ok = Object.keys(missing).length === 0;
  return { ok, found, missing, buckets };
}
