import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
export declare function renderToolTable(result: CallToolResult): string;
export declare function printData(data: unknown, json: boolean): void;
export declare function printToolResult(result: CallToolResult, json: boolean, table?: boolean): number;
export declare function toolText(result: CallToolResult): string;
