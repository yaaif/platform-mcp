import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AuthClient } from "../auth/oidc.js";
import type { ApiClient } from "../client/http.js";
import type { Config } from "../config.js";
export type Ctx = {
    cfg: Config;
    auth: AuthClient;
    api: ApiClient;
};
export declare function registerAllTools(server: McpServer, ctx: Ctx): void;
