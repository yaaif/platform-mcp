import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Ctx } from "./ctx.js";
/** Env injected into MCP pods as process-level fallback (matches api-server / pkg/mcpplatformkey). */
export declare const PLATFORM_API_KEY_ENV = "YAAIF_MCP_PLATFORM_API_KEY";
/** Preferred binding header (avoids clobbering MCP inbound Authorization). */
export declare const PLATFORM_API_KEY_HEADER = "X-YAAIF-Platform-Key";
/**
 * Tenant API keys (ymp-…) for downstream callers (primarily MCP servers) hitting
 * YAAIF platform APIs. Managed via api-server /api/mcp-platform-keys.
 * Never use platform S2S, desktop connection keys, or AI-gateway keys for this.
 */
export declare function registerApiKeyTools(server: McpServer, ctx: Ctx): void;
