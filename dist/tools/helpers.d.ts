import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
export declare function ok(summary: string, data?: unknown): CallToolResult;
export declare function fail(message: string, data?: Record<string, unknown>): CallToolResult;
