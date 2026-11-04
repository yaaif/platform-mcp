import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Ctx } from "./ctx.js";
type ServerTool = {
    name?: string;
    input_schema?: unknown;
};
/** Apply one argument map to every server tool that declares those arguments. */
export declare function injectAcrossTools(tools: ServerTool[], args: Record<string, string>): Record<string, Record<string, string>>;
export declare function registerCredentialTools(server: McpServer, ctx: Ctx): void;
export {};
