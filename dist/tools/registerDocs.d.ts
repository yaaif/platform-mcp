import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Ctx } from "./ctx.js";
export type DocPageBody = {
    slug: string;
    title: string;
    markdown: string;
};
export type RankedDocHit = {
    slug: string;
    title: string;
    score: number;
    excerpt: string;
};
export declare function queryTerms(query: string): string[];
export declare function excerptAround(markdown: string, query: string, chars?: number): string;
/** Title hits outweigh body hits. Pages with no hit are omitted. */
export declare function rankDocPages(pages: DocPageBody[], query: string, limit?: number): RankedDocHit[];
export declare function registerDocsTools(server: McpServer, ctx: Ctx): void;
