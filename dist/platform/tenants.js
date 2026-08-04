function asArray(value) {
    if (Array.isArray(value))
        return value;
    if (value && typeof value === "object") {
        const obj = value;
        if (Array.isArray(obj.items))
            return obj.items;
    }
    return [];
}
export function parseTenantMemberships(raw) {
    return asArray(raw).map((row) => {
        const o = (row && typeof row === "object" ? row : {});
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
function slugify(name) {
    return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
export function normalizeTenants(memberships, opts = {}) {
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
export function resolveTenant(memberships, query) {
    const q = query.trim();
    if (!q)
        return { error: "tenant query is empty" };
    const ql = q.toLowerCase();
    const byId = memberships.find((m) => m.tenant_id.toLowerCase() === ql);
    if (byId)
        return { tenant: byId };
    const byName = memberships.filter((m) => m.tenant_name.toLowerCase() === ql);
    if (byName.length === 1)
        return { tenant: byName[0] };
    if (byName.length > 1)
        return { error: `ambiguous tenant name: ${q}`, candidates: byName };
    const bySlug = memberships.filter((m) => slugify(m.tenant_name) === ql);
    if (bySlug.length === 1)
        return { tenant: bySlug[0] };
    if (bySlug.length > 1)
        return { error: `ambiguous tenant slug: ${q}`, candidates: bySlug };
    const partial = memberships.filter((m) => m.tenant_name.toLowerCase().includes(ql) ||
        m.tenant_id.toLowerCase().includes(ql) ||
        slugify(m.tenant_name).includes(ql));
    if (partial.length === 1)
        return { tenant: partial[0] };
    if (partial.length > 1)
        return { error: `ambiguous tenant query: ${q}`, candidates: partial };
    return { error: `tenant not found: ${q}` };
}
export function parseLastTenantId(raw) {
    if (!raw || typeof raw !== "object")
        return "";
    const o = raw;
    return String(o.last_tenant_id ?? o.tenant_id ?? "").trim();
}
