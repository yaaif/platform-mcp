function asArray(value) {
    if (Array.isArray(value))
        return value;
    if (value && typeof value === "object") {
        const obj = value;
        if (Array.isArray(obj.items))
            return obj.items;
        if (Array.isArray(obj.names))
            return obj.names;
        if (Array.isArray(obj.skills))
            return obj.skills;
        if (Array.isArray(obj.agents))
            return obj.agents;
        if (Array.isArray(obj.workflows))
            return obj.workflows;
        if (Array.isArray(obj.tools))
            return obj.tools;
    }
    return [];
}
function nameOf(row) {
    if (typeof row === "string")
        return row.trim();
    if (!row || typeof row !== "object")
        return "";
    const o = row;
    return String(o.name ?? o.id ?? "").trim();
}
function idOf(row) {
    if (typeof row === "string")
        return row.trim();
    if (!row || typeof row !== "object")
        return "";
    const o = row;
    return String(o.id ?? "").trim();
}
export function extractCatalogBuckets(raw) {
    const localRaw = raw.local_tools;
    let localRows = asArray(localRaw);
    if (localRaw && typeof localRaw === "object" && Array.isArray(localRaw.names)) {
        localRows = localRaw.names;
    }
    return {
        agents: asArray(raw.agents).map((r) => ({ id: idOf(r), name: nameOf(r) })),
        skills: asArray(raw.skills).map((r) => ({ id: idOf(r) || nameOf(r), name: nameOf(r) })),
        workflows: asArray(raw.ambient_workflows).map((r) => ({ id: idOf(r), name: nameOf(r) })),
        mcp_tools: asArray(raw.mcp_tools).map((r) => ({ id: idOf(r), name: nameOf(r) })),
        ambient_agents: asArray(raw.ambient_agents).map((r) => ({ id: idOf(r), name: nameOf(r) })),
        local_tools: localRows.map((r) => {
            const n = nameOf(r);
            return { id: n, name: n };
        }),
    };
}
function hasName(rows, want) {
    const target = want.trim().toLowerCase();
    if (!target)
        return true;
    return rows.some((r) => {
        const n = (r.name || "").toLowerCase();
        const id = (r.id || "").toLowerCase();
        return n === target || id === target || id.endsWith(`/${target}`) || n.includes(target);
    });
}
export function verifyPlanAgainstCatalog(expectations, buckets) {
    const missing = {};
    const found = {};
    const check = (key, rows) => {
        const wants = expectations[key] ?? [];
        for (const want of wants) {
            if (hasName(rows, want)) {
                (found[key] ??= []).push(want);
            }
            else {
                (missing[key] ??= []).push(want);
            }
        }
    };
    check("agent_names", buckets.agents);
    check("skill_ids", buckets.skills);
    check("workflow_names", buckets.workflows);
    check("mcp_tool_names", buckets.mcp_tools);
    check("ambient_agent_names", buckets.ambient_agents);
    check("local_tool_names", buckets.local_tools);
    const ok = Object.keys(missing).length === 0;
    return { ok, found, missing, buckets };
}
