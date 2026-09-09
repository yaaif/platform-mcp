/** Agent-service list endpoints reject limit outside 1–200. */
export const CATALOG_LIST_LIMIT_MAX = 200;
export const MCP_TOOLS_PAGE_LIMIT = CATALOG_LIST_LIMIT_MAX;
export const MCP_TOOLS_MAX_PAGES = 50;
export function clampCatalogLimit(limit, fallback) {
    const base = typeof limit === "number" && Number.isFinite(limit) && limit > 0
        ? Math.floor(limit)
        : fallback;
    const safeFallback = Math.min(Math.max(Math.floor(fallback) || 1, 1), CATALOG_LIST_LIMIT_MAX);
    return Math.min(Math.max(base, 1), CATALOG_LIST_LIMIT_MAX) || safeFallback;
}
/** Set `limit` on a querystring only when the caller provided a positive value, capped at 200. */
export function appendClampedLimit(params, limit) {
    if (typeof limit !== "number" || !Number.isFinite(limit) || limit <= 0)
        return;
    params.set("limit", String(clampCatalogLimit(limit, 20)));
}
export async function listAllMcpToolNames(getJSON) {
    const names = [];
    let offset = 0;
    for (let page = 0; page < MCP_TOOLS_MAX_PAGES; page++) {
        const path = `/api/mcp-tools?limit=${MCP_TOOLS_PAGE_LIMIT}&offset=${offset}`;
        const res = await getJSON(path);
        for (const item of res.items ?? []) {
            const n = String(item.name ?? "").trim();
            if (n)
                names.push(n);
        }
        if (!res.pagination?.has_more)
            break;
        const next = res.pagination.next_offset ?? offset + MCP_TOOLS_PAGE_LIMIT;
        if (next <= offset)
            break;
        offset = next;
    }
    return names;
}
