/** Agent-service list endpoints reject limit outside 1–200. */
export declare const CATALOG_LIST_LIMIT_MAX = 200;
export declare const MCP_TOOLS_PAGE_LIMIT = 200;
export declare const MCP_TOOLS_MAX_PAGES = 50;
export declare function clampCatalogLimit(limit: number | undefined, fallback: number): number;
/** Set `limit` on a querystring only when the caller provided a positive value, capped at 200. */
export declare function appendClampedLimit(params: URLSearchParams, limit: number | undefined): void;
export type McpToolsPage = {
    items?: Array<{
        name?: string;
    }>;
    pagination?: {
        has_more?: boolean;
        next_offset?: number;
    };
};
export declare function listAllMcpToolNames(getJSON: (path: string) => Promise<McpToolsPage>): Promise<string[]>;
