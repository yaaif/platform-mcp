#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { AuthClient } from "./auth/oidc.js";
import { SessionStore } from "./auth/store.js";
import { ApiClient } from "./client/http.js";
import { installTlsDispatcher } from "./client/tls.js";
import { loadConfig, parseBridgeClient } from "./config.js";
import { PlanExecutionStore } from "./lib/planExecution.js";
import { TelemetryStore } from "./lib/telemetry.js";
import { parseSetupAction, runInstallerSetup } from "./lib/installerSetup.js";
import { parseInstallAction, runInstall } from "./lib/pluginInstall.js";
import { applyActiveProfile, applyProfileToConfig, ProfileStore } from "./platform/profiles.js";
import { registerAllTools } from "./tools/register.js";

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (parseInstallAction(argv)) {
    const code = await runInstall({ argv });
    process.exit(code);
  }
  const setup = parseSetupAction(argv);
  if (setup) {
    const code = await runInstallerSetup(setup, { argv });
    process.exit(code);
  }

  const cfg = loadConfig(parseBridgeClient());
  const store = new SessionStore(cfg.stateHome);
  await store.ensureHome(cfg.stateHome);
  const profiles = new ProfileStore(cfg.stateHome, cfg.client.oidcClientId);
  await profiles.ensureHome();
  // Prefer the persisted client profile over environment defaults, so a selected
  // local-hybrid profile is not overwritten by the hosted default on restart.
  const fromFile = await applyActiveProfile(cfg, profiles);
  if (!fromFile && cfg.activeProfileId) {
    const p = await profiles.get(cfg.activeProfileId);
    if (p) applyProfileToConfig(cfg, p);
  }
  installTlsDispatcher(cfg);

  const auth = new AuthClient(cfg, store);
  const api = new ApiClient(cfg, auth);
  const plans = new PlanExecutionStore(cfg.stateHome);
  const telemetry = new TelemetryStore(cfg.stateHome);

  const server = new McpServer({
    name: `yaaif-${cfg.client.id}`,
    version: "1.2.0",
  });
  registerAllTools(server, { cfg, auth, api, profiles, plans, telemetry });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
