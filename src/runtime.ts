import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { AuthClient } from "./auth/oidc.js";
import { SessionStore } from "./auth/store.js";
import { ApiClient } from "./client/http.js";
import { installTlsDispatcher } from "./client/tls.js";
import { loadConfig, type ClientDescriptor } from "./config.js";
import { PlanExecutionStore } from "./lib/planExecution.js";
import { TelemetryStore } from "./lib/telemetry.js";
import { applyActiveProfile, applyProfileToConfig, inferProfileId, lockedProfileFromConfig, ProfileStore } from "./platform/profiles.js";
import { adoptIssuerSession } from "./platform/lockSession.js";
import { registerAllTools } from "./tools/register.js";
import type { Ctx } from "./tools/ctx.js";
import { PACKAGE_VERSION } from "./version.js";

export type Runtime = Ctx & {
  store: SessionStore;
};

export async function createRuntime(client: ClientDescriptor, profileId?: string): Promise<Runtime> {
  const cfg = loadConfig(client);
  const profiles = new ProfileStore(cfg.stateHome, cfg.client.oidcClientId);
  await profiles.ensureHome();
  if (cfg.platformLocked) {
    // The installation's environment decides the platform, not a profile an
    // agent saved or activated in an earlier session.
    applyProfileToConfig(cfg, await profiles.lock(lockedProfileFromConfig(cfg)));
  } else if (profileId) {
    const profile = await profiles.get(profileId);
    if (!profile) throw new Error(`unknown profile: ${profileId}`);
    applyProfileToConfig(cfg, profile);
  } else {
    const fromFile = await applyActiveProfile(cfg, profiles);
    if (!fromFile && cfg.activeProfileId) {
      const profile = await profiles.get(cfg.activeProfileId);
      if (profile) applyProfileToConfig(cfg, profile);
    }
  }
  cfg.activeProfileId = cfg.activeProfileId || inferProfileId(cfg);
  const store = SessionStore.forProfile(cfg.stateHome, cfg.activeProfileId);
  await store.ensureHome(cfg.stateHome);
  if (!profileId) await store.migrateLegacySession(cfg.stateHome);
  if (cfg.platformLocked) {
    const from = await adoptIssuerSession(cfg.stateHome, store, cfg.activeProfileId, cfg.oidcAuthority).catch(() => null);
    if (from) console.error(`yaaif: using the ${from} sign-in for ${cfg.activeProfileId} (same issuer)`);
  }
  installTlsDispatcher(cfg);
  const auth = new AuthClient(cfg, store);
  return {
    cfg,
    store,
    profiles,
    auth,
    api: new ApiClient(cfg, auth),
    plans: new PlanExecutionStore(cfg.stateHome),
    telemetry: new TelemetryStore(cfg.stateHome),
  };
}

export function createMcpServer(runtime: Runtime): McpServer {
  const server = new McpServer({
    name: `yaaif-${runtime.cfg.client.id}`,
    version: PACKAGE_VERSION,
  });
  registerAllTools(server, runtime);
  return server;
}
