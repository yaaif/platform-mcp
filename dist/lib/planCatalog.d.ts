export type PlanExpectations = {
    agent_names?: string[];
    skill_ids?: string[];
    workflow_names?: string[];
    mcp_tool_names?: string[];
    ambient_agent_names?: string[];
    /** Platform local tool names expected in skill frontmatter / plan. */
    local_tool_names?: string[];
};
export type CatalogBuckets = {
    agents: {
        id?: string;
        name?: string;
    }[];
    skills: {
        id?: string;
        name?: string;
    }[];
    workflows: {
        id?: string;
        name?: string;
    }[];
    mcp_tools: {
        id?: string;
        name?: string;
    }[];
    ambient_agents: {
        id?: string;
        name?: string;
    }[];
    local_tools: {
        id?: string;
        name?: string;
    }[];
};
export declare function extractCatalogBuckets(raw: Record<string, unknown>): CatalogBuckets;
export declare function verifyPlanAgainstCatalog(expectations: PlanExpectations, buckets: CatalogBuckets): {
    ok: boolean;
    found: Record<string, string[]>;
    missing: Record<string, string[]>;
    buckets: CatalogBuckets;
};
