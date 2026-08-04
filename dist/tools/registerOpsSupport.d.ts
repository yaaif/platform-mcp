import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Ctx } from "./ctx.js";
/** Strictly read-only operations support tools (no pause/stop/approve/retry). */
export declare function registerOpsSupportTools(server: McpServer, ctx: Ctx): void;
