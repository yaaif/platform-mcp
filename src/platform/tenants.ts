export type TenantMembership = {
  tenant_id: string;
  tenant_name: string;
  role?: string;
  status?: string;
  active?: boolean;
};

export type NormalizedTenant = {
  id: string;
  name: string;
  slug: string;
  role?: string;
  status?: string;
  active?: boolean;
  is_last: boolean;
  is_selected: boolean;
};

function asArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if (Array.isArray(obj.items)) return obj.items;
  }
  return [];
}

export function parseTenantMemberships(raw: unknown): TenantMembership[] {
  return asArray(raw).map((row) => {
    const o = (row && typeof row === "object" ? row : {}) as Record<string, unknown>;
    const tenant_id = String(o.tenant_id ?? o.id ?? "").trim();
    const tenant_name = String(o.tenant_name ?? o.name ?? tenant_id).trim();
    return {
      tenant_id,
      tenant_name,
      role: typeof o.role === "string" ? o.role : undefined,
      status: typeof o.status === "string" ? o.status : undefined,
      active: typeof o.active === "boolean" ? o.active : undefined,
    };
  }).filter((t) => t.tenant_id);
}

function slugify(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export function normalizeTenants(
  memberships: TenantMembership[],
  opts: { selectedTenantId?: string; lastTenantId?: string } = {},
): NormalizedTenant[] {
  const selected = (opts.selectedTenantId || "").trim().toLowerCase();
  const last = (opts.lastTenantId || "").trim().toLowerCase();
  return memberships.map((m) => {
    const id = m.tenant_id;
    const name = m.tenant_name || id;
    return {
      id,
      name,
      slug: slugify(name) || id.toLowerCase(),
      role: m.role,
      status: m.status,
      active: m.active,
      is_last: id.toLowerCase() === last,
      is_selected: id.toLowerCase() === selected,
    };
  });
}

/** Resolve tenant by uuid, exact name, slug, or unique substring. */
export function resolveTenant(
  memberships: TenantMembership[],
  query: string,
): { tenant: TenantMembership } | { error: string; candidates?: TenantMembership[] } {
  const q = query.trim();
  if (!q) return { error: "tenant query is empty" };
  const ql = q.toLowerCase();

  const byId = memberships.find((m) => m.tenant_id.toLowerCase() === ql);
  if (byId) return { tenant: byId };

  const byName = memberships.filter((m) => m.tenant_name.toLowerCase() === ql);
  if (byName.length === 1) return { tenant: byName[0] };
  if (byName.length > 1) return { error: `ambiguous tenant name: ${q}`, candidates: byName };

  const bySlug = memberships.filter((m) => slugify(m.tenant_name) === ql);
  if (bySlug.length === 1) return { tenant: bySlug[0] };
  if (bySlug.length > 1) return { error: `ambiguous tenant slug: ${q}`, candidates: bySlug };

  const partial = memberships.filter(
    (m) =>
      m.tenant_name.toLowerCase().includes(ql) ||
      m.tenant_id.toLowerCase().includes(ql) ||
      slugify(m.tenant_name).includes(ql),
  );
  if (partial.length === 1) return { tenant: partial[0] };
  if (partial.length > 1) return { error: `ambiguous tenant query: ${q}`, candidates: partial };
  return { error: `tenant not found: ${q}` };
}

export function parseLastTenantId(raw: unknown): string {
  if (!raw || typeof raw !== "object") return "";
  const o = raw as Record<string, unknown>;
  return String(o.last_tenant_id ?? o.tenant_id ?? "").trim();
}
