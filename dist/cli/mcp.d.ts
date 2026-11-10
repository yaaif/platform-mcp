import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";
import { type Runtime } from "../runtime.js";
export type CliMcp = {
    runtime: Runtime;
    client: Client;
    close: () => Promise<void>;
};
export declare function openCliMcp(): Promise<CliMcp>;
export declare function listTools(client: Client): Promise<Tool[]>;
export declare function callTool(client: Client, name: string, args: Record<string, unknown>): Promise<CallToolResult>;
