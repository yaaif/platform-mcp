import assert from "node:assert/strict";
import { test } from "node:test";
import { loadConfig } from "./config.js";

test("loadConfig reads env defaults", () => {
  process.env.YAAIF_OIDC_AUTHORITY = "https://example.com/auth/realms/yaaif";
  process.env.YAAIF_API_BASE_URL = "https://example.com/api-host/";
  process.env.YAAIF_AGENT_BASE_URL = "https://example.com/agent-host/";
  process.env.YAAIF_OIDC_CLIENT_ID = "yaaif-cursor";
  const cfg = loadConfig();
  assert.equal(cfg.oidcAuthority, "https://example.com/auth/realms/yaaif");
  assert.equal(cfg.apiBaseUrl, "https://example.com/api-host");
  assert.equal(cfg.agentBaseUrl, "https://example.com/agent-host");
  assert.equal(cfg.oidcClientId, "yaaif-cursor");
});
