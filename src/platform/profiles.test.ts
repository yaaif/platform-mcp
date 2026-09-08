import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { loadConfig } from "../config.js";
import {
  applyProfileToConfig,
  BUILTIN_PROFILES,
  normalizePlatformUrl,
  profileFromPlatformUrl,
  profileIdFromHostname,
  ProfileStore,
} from "./profiles.js";

test("builtin profiles include hosted and local-hybrid", () => {
  assert.ok(BUILTIN_PROFILES.some((p) => p.id === "hosted"));
  assert.ok(BUILTIN_PROFILES.some((p) => p.id === "local-hybrid"));
});

test("profileFromPlatformUrl maps hosted, local, and custom bases", () => {
  assert.equal(normalizePlatformUrl("platform.yaaif.ai"), "https://platform.yaaif.ai");
  assert.equal(
    normalizePlatformUrl("https://yaaif.acme.example/auth/realms/yaaif"),
    "https://yaaif.acme.example",
  );
  assert.equal(profileFromPlatformUrl("https://platform.yaaif.ai/").id, "hosted");
  assert.equal(profileFromPlatformUrl("https://platform.yaaif.local").id, "local");
  const custom = profileFromPlatformUrl("https://yaaif.acme.example", "yaaif-claude");
  assert.equal(custom.id, "yaaif-acme-example");
  assert.equal(custom.builtin, false);
  assert.equal(custom.api_base_url, "https://yaaif.acme.example");
  assert.equal(custom.oidc_authority, "https://yaaif.acme.example/auth/realms/yaaif");
  assert.equal(custom.oidc_client_id, "yaaif-claude");
  assert.equal(profileIdFromHostname("10.0.0.8"), "p-10-0-0-8");
});

test("ProfileStore upsert and activate custom profile", async () => {
  const home = await mkdtemp(join(tmpdir(), "yaaif-prof-"));
  try {
    const store = new ProfileStore(home);
    const saved = await store.upsertCustom({
      id: "customer-prod",
      label: "Customer Prod",
      oidc_authority: "https://example.com/auth/realms/yaaif",
      api_base_url: "https://example.com",
      agent_base_url: "",
      control_plane_base_url: "",
      approval_base_url: "",
    });
    assert.equal(saved.agent_base_url, "https://example.com/agent-service");
    await store.setActive("customer-prod");
    const active = await store.getActive();
    assert.equal(active?.profile_id, "customer-prod");
    const cfg = loadConfig();
    applyProfileToConfig(cfg, saved);
    assert.equal(cfg.apiBaseUrl, "https://example.com");
    assert.equal(cfg.activeProfileId, "customer-prod");
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
