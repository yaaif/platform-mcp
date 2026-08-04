#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { AuthClient } from "./auth/oidc.js";
import { SessionStore } from "./auth/store.js";
import { ApiClient } from "./client/http.js";
import { loadConfig } from "./config.js";
import { applyActiveProfile, applyProfileToConfig, ProfileStore } from "./platform/profiles.js";
import { registerAllTools } from "./tools/register.js";
async function main() {
    const cfg = loadConfig();
    const store = new SessionStore(cfg.cursorHome);
    await store.ensureHome(cfg.cursorHome);
    const profiles = new ProfileStore(cfg.cursorHome);
    await profiles.ensureHome();
    // Env YAAIF_PLATFORM_PROFILE or saved active-profile.json wins over raw URL defaults.
    if (cfg.activeProfileId) {
        const p = await profiles.get(cfg.activeProfileId);
        if (p)
            applyProfileToConfig(cfg, p);
    }
    else {
        await applyActiveProfile(cfg, profiles);
    }
    const auth = new AuthClient(cfg, store);
    const api = new ApiClient(cfg, auth);
    const server = new McpServer({
        name: "yaaif-cursor",
        version: "0.5.0",
    });
    registerAllTools(server, { cfg, auth, api, profiles });
    const transport = new StdioServerTransport();
    await server.connect(transport);
}
main().catch((err) => {
    console.error(err);
    process.exit(1);
});
