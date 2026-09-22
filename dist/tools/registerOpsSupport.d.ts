import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Ctx } from "./ctx.js";
/** Operations support tools: read-only analyze/telemetry + confirmed diagnosis write-back. */
export declare function registerOpsSupportTools(server: McpServer, ctx: Ctx): void;
