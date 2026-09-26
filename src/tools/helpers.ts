import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

function textWithData(summary: string, data?: unknown): string {
  if (data === undefined) return summary;
  try {
    return `${summary}\n\n${JSON.stringify(data, null, 2)}`;
  } catch {
    return summary;
  }
}

export function ok(summary: string, data?: unknown): CallToolResult {
  const structured = (data ?? { ok: true }) as Record<string, unknown>;
  return {
    content: [{ type: "text", text: textWithData(summary, data === undefined ? undefined : structured) }],
    structuredContent: structured,
  };
}

export function fail(message: string, data?: Record<string, unknown>): CallToolResult {
  const structured = { error: message, ...(data ?? {}) };
  return {
    content: [{ type: "text", text: textWithData(message, data ? structured : undefined) }],
    isError: true,
    structuredContent: structured,
  };
}
