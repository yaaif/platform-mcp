import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Ctx } from "./ctx.js";
/**
 * HTTP file/artifact helpers for ADK-style artifact names + versions.
 * Prefer local tools (yaaif_files_list / yaaif_load_artifacts / yaaif_file_load_context)
 * for skill authoring; use these when you need version history or REST parity.
 */
export declare function registerFileTools(server: McpServer, ctx: Ctx): void;
