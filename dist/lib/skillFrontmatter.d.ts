/** Minimal SKILL.md frontmatter tool extraction (no YAML dependency). */
export declare function extractFrontmatterBlock(markdown: string): string;
/** Prefer allowed-tools, fall back to tools (platform skillspec parity). */
export declare function extractSkillToolsFromMarkdown(markdown: string): string[];
export declare function extractSkillPromptsFromMarkdown(markdown: string): string[];
export declare function extractSkillResourcesFromMarkdown(markdown: string): string[];
export declare function isServerWildcardToken(token: string): boolean;
export type ToolCheckResult = {
    ok: boolean;
    tools: string[];
    found_local: string[];
    found_mcp: string[];
    missing: string[];
};
export declare function verifyToolsAgainstCatalogs(tools: string[], localNames: string[], mcpNames: string[]): ToolCheckResult;
