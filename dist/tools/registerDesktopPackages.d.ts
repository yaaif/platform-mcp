import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Ctx } from "./ctx.js";
/**
 * Desktop Package Registry for command/stdio MCP servers (Admin UI Catalog → Desktop tools).
 * HTTP MCP servers still use yaaif_mcp_deployment_*.
 */
export declare function registerDesktopPackageTools(server: McpServer, ctx: Ctx): void;
