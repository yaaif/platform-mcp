import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export function ok(summary: string, data?: unknown): CallToolResult {
  return {
    content: [{ type: "text", text: summary }],
    structuredContent: (data ?? { ok: true }) as Record<string, unknown>,
  };
}

export function fail(message: string): CallToolResult {
  return {
    content: [{ type: "text", text: message }],
    isError: true,
    structuredContent: { error: message },
  };
}
