import assert from "node:assert/strict";
import { test } from "node:test";
import { clientDescriptor, loadConfig, parseBridgeClient } from "./config.js";

test("loadConfig reads env defaults", () => {
  process.env.YAAIF_OIDC_AUTHORITY = "https://example.com/auth/realms/yaaif";
  process.env.YAAIF_API_BASE_URL = "https://example.com/api-host/";
  process.env.YAAIF_AGENT_BASE_URL = "https://example.com/agent-host/";
  process.env.YAAIF_CONTROL_PLANE_BASE_URL = "https://example.com/cp/";
  process.env.YAAIF_APPROVAL_BASE_URL = "https://example.com/appr/";
  process.env.YAAIF_OIDC_CLIENT_ID = "yaaif-cursor";
  delete process.env.YAAIF_PLATFORM_PROFILE;
  delete process.env.YAAIF_EXTRA_CA_FILE;
  delete process.env.NODE_EXTRA_CA_CERTS;
  const cfg = loadConfig();
  assert.equal(cfg.oidcAuthority, "https://example.com/auth/realms/yaaif");
  assert.equal(cfg.apiBaseUrl, "https://example.com/api-host");
  assert.equal(cfg.agentBaseUrl, "https://example.com/agent-host");
  assert.equal(cfg.controlPlaneBaseUrl, "https://example.com/cp");
  assert.equal(cfg.approvalBaseUrl, "https://example.com/appr");
  assert.equal(cfg.oidcClientId, "yaaif-cursor");
  assert.equal(cfg.activeProfileId, "");
  assert.equal(cfg.extraCaFile, "");
});

test("loadConfig ignores unexpanded plugin placeholders", () => {
  process.env.YAAIF_OIDC_AUTHORITY = "${YAAIF_OIDC_AUTHORITY}";
  process.env.YAAIF_API_BASE_URL = "${YAAIF_API_BASE_URL}";
  process.env.YAAIF_AGENT_BASE_URL = "${YAAIF_AGENT_BASE_URL}";
  process.env.YAAIF_CONTROL_PLANE_BASE_URL = "${YAAIF_CONTROL_PLANE_BASE_URL}";
  process.env.YAAIF_APPROVAL_BASE_URL = "${YAAIF_APPROVAL_BASE_URL}";
  delete process.env.YAAIF_OIDC_CLIENT_ID;
  const cfg = loadConfig();
  assert.equal(cfg.oidcAuthority, "https://platform.yaaif.ai/auth/realms/yaaif");
  assert.equal(cfg.apiBaseUrl, "https://platform.yaaif.ai");
  assert.equal(cfg.agentBaseUrl, "https://platform.yaaif.ai/agent-service");
  assert.equal(cfg.controlPlaneBaseUrl, "https://platform.yaaif.ai/control-plane-service");
  assert.equal(cfg.approvalBaseUrl, "https://platform.yaaif.ai/approval-service");
  assert.equal(cfg.oidcClientId, "yaaif-cursor");
});

test("Codex defaults use isolated state and OIDC client", () => {
  delete process.env.YAAIF_OIDC_CLIENT_ID;
  delete process.env.YAAIF_CODEX_HOME;
  process.env.YAAIF_STATE_HOME = "/tmp/legacy-shared-state";
  const cfg = loadConfig(clientDescriptor("codex"));
  assert.equal(cfg.oidcClientId, "yaaif-codex");
  assert.match(cfg.stateHome, /\.yaaif\/codex$/);
  assert.equal(cfg.client.updatedBy, "yaaif-codex");
  delete process.env.YAAIF_STATE_HOME;
});

test("parseBridgeClient requires exactly one supported client", () => {
  assert.equal(parseBridgeClient(["--client", "codex"]).id, "codex");
  assert.equal(parseBridgeClient(["--client=cursor"]).id, "cursor");
  assert.throws(() => parseBridgeClient([]), /--client cursor\|codex/);
  assert.throws(() => parseBridgeClient(["--client", "unknown"]), /--client cursor\|codex/);
});
