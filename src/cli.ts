#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { AuthClient } from "./auth/oidc.js";
import { SessionStore } from "./auth/store.js";
import { ApiClient } from "./client/http.js";
import { loadConfig } from "./config.js";
import { registerAllTools } from "./tools/register.js";

async function main(): Promise<void> {
  const cfg = loadConfig();
  const store = new SessionStore(cfg.cursorHome);
  await store.ensureHome(cfg.cursorHome);
  const auth = new AuthClient(cfg, store);
  const api = new ApiClient(cfg, auth);

  const server = new McpServer({
    name: "yaaif-cursor",
    version: "0.2.0",
  });
  registerAllTools(server, { cfg, auth, api });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
