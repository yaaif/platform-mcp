import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CLI_CLIENT, loadConfig } from "../config.js";
import { AuthClient } from "./oidc.js";
import { SessionStore, type Session } from "./store.js";

function session(profile: string, token: string): Session {
  return {
    profile_id: profile,
    oidc_authority: `https://${profile}.example/auth/realms/yaaif`,
    tenant_id: `tenant-${profile}`,
    tokens: { access_token: token, expiry: "2099-01-01T00:00:00Z" },
  };
}

test("profile sessions keep tokens and tenants isolated", async () => {
  const home = await mkdtemp(join(tmpdir(), "yaaif-profile-sessions-"));
  try {
    const prod = SessionStore.forProfile(home, "prod");
    const stage = SessionStore.forProfile(home, "stage");
    await prod.save(session("prod", "prod-token"));
    await stage.save(session("stage", "stage-token"));
    assert.equal((await prod.load())?.tokens.access_token, "prod-token");
    assert.equal((await stage.load())?.tenant_id, "tenant-stage");
    await assert.rejects(() => SessionStore.forProfile(home, "other").save(session("prod", "bad")), /refusing to save/);
    await mkdir(join(home, "profile-sessions", "other"), { recursive: true });
    await writeFile(join(home, "profile-sessions", "other", "session.json"), JSON.stringify(session("prod", "bad")));
    await assert.rejects(() => SessionStore.forProfile(home, "other").load(), /belongs to profile/);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("legacy session migrates only into its matching profile", async () => {
  const home = await mkdtemp(join(tmpdir(), "yaaif-legacy-session-"));
  try {
    const legacy = new SessionStore(home);
    await legacy.save(session("prod", "prod-token"));
    const other = SessionStore.forProfile(home, "other");
    assert.equal(await other.migrateLegacySession(home), false);
    const prod = SessionStore.forProfile(home, "prod");
    assert.equal(await prod.migrateLegacySession(home), true);
    assert.equal((await prod.load())?.tokens.access_token, "prod-token");
    assert.equal(JSON.parse(await readFile(join(home, "session.json"), "utf8")).tokens.access_token, "prod-token");
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("AuthClient restores each profile session when switching", async () => {
  const home = await mkdtemp(join(tmpdir(), "yaaif-auth-profile-switch-"));
  try {
    const cfg = loadConfig(CLI_CLIENT);
    cfg.stateHome = home;
    cfg.oidcAuthority = "https://prod.example/auth/realms/yaaif";
    const auth = new AuthClient(cfg, SessionStore.forProfile(home, "prod"));
    await auth.useProfile("prod");
    await SessionStore.forProfile(home, "prod").save(session("prod", "prod-token"));
    await auth.setTenant("tenant-prod", "Production");
    await auth.useProfile("stage");
    assert.equal(await auth.session(), null);
    await auth.useProfile("prod");
    assert.equal((await auth.session())?.tenant_id, "tenant-prod");
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
