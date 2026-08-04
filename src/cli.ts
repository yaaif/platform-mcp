#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { AuthClient } from "./auth/oidc.js";
import { SessionStore } from "./auth/store.js";
import { ApiClient } from "./client/http.js";
import { installTlsDispatcher } from "./client/tls.js";
import { loadConfig } from "./config.js";
import { PlanExecutionStore } from "./lib/planExecution.js";
import { TelemetryStore } from "./lib/telemetry.js";
import { applyActiveProfile, applyProfileToConfig, ProfileStore } from "./platform/profiles.js";
import { registerAllTools } from "./tools/register.js";

async function main(): Promise<void> {
  const cfg = loadConfig();
  const store = new SessionStore(cfg.cursorHome);
  await store.ensureHome(cfg.cursorHome);
  const profiles = new ProfileStore(cfg.cursorHome);
  await profiles.ensureHome();
  if (cfg.activeProfileId) {
    const p = await profiles.get(cfg.activeProfileId);
    if (p) applyProfileToConfig(cfg, p);
  } else {
    await applyActiveProfile(cfg, profiles);
  }
  installTlsDispatcher(cfg);

  const auth = new AuthClient(cfg, store);
  const api = new ApiClient(cfg, auth);
  const plans = new PlanExecutionStore(cfg.cursorHome);
  const telemetry = new TelemetryStore(cfg.cursorHome);

  const server = new McpServer({
    name: "yaaif-cursor",
    version: "0.6.0",
  });
  registerAllTools(server, { cfg, auth, api, profiles, plans, telemetry });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
