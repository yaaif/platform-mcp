import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Ctx } from "./ctx.js";
/**
 * File workflows: ambient workflows triggered by file.ready / file.failed /
 * file.review_decided that read the extracted file, process it and reply to the
 * origin. The template tool is read-only; the create tool installs under an
 * existing ambient agent.
 */
export declare function registerFileWorkflowTools(server: McpServer, ctx: Ctx): void;
