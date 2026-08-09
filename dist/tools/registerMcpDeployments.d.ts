import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Ctx } from "./ctx.js";
/**
 * MCP deployment lifecycle + settings preflight for docker_compose and kubernetes_gitops.
 */
export declare function registerMcpDeploymentTools(server: McpServer, ctx: Ctx): void;
