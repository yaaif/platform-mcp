import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SessionStore } from "./auth/store.js";
import { type ClientDescriptor } from "./config.js";
import type { Ctx } from "./tools/ctx.js";
export type Runtime = Ctx & {
    store: SessionStore;
};
export declare function createRuntime(client: ClientDescriptor, profileId?: string): Promise<Runtime>;
export declare function createMcpServer(runtime: Runtime): McpServer;
