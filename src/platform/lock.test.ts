import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SessionStore } from "../auth/store.js";
import { callTool, openCliMcp } from "../cli/mcp.js";
import { loadConfig, CLI_CLIENT } from "../config.js";
import { adoptIssuerSession } from "./lockSession.js";
import { lockedProfileFromConfig, PlatformLockedError, ProfileStore } from "./profiles.js";

const LOCK_ENV = ["YAAIF_CLI_HOME", "YAAIF_PLATFORM_LOCKED", "YAAIF_OIDC_AUTHORITY", "YAAIF_API_BASE_URL", "YAAIF_PLATFORM_PROFILE"];

async function withEnv<T>(values: Record<string, string>, run: () => Promise<T>): Promise<T> {
  const saved = Object.fromEntries(LOCK_ENV.map((key) => [key, process.env[key]]));
  for (const key of LOCK_ENV) delete process.env[key];
  Object.assign(process.env, values);
  try {
    return await run();
  } finally {
    for (const key of LOCK_ENV) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
}

function session(profileId: string, authority: string, accessToken = "at") {
  return {
    tokens: { access_token: accessToken, refresh_token: "rt", token_type: "Bearer", expiry: new Date(Date.now() + 3_600_000).toISOString() },
    profile_id: profileId,
    oidc_authority: authority,
  };
}

// Discovery for ensure_session's OIDC probe.
async function fakeIssuer() {
  const server = http.createServer((req, res) => {
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/auth/realms/yaaif`;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ issuer: base, authorization_endpoint: `${base}/protocol/openid-connect/auth`, token_endpoint: `${base}/protocol/openid-connect/token` }));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { origin, authority: `${origin}/auth/realms/yaaif`, close: () => new Promise<void>((r) => { server.closeAllConnections(); server.close(() => r()); }) };
}

test("the locked profile comes from the installation's environment", async () => {
  await withEnv({ YAAIF_OIDC_AUTHORITY: "https://platform.example.test/auth/realms/yaaif", YAAIF_API_BASE_URL: "https://platform.example.test" }, async () => {
    const profile = lockedProfileFromConfig(loadConfig(CLI_CLIENT));
    assert.equal(profile.id, "platform-example-test");
    assert.equal(profile.oidc_authority, "https://platform.example.test/auth/realms/yaaif");
    assert.equal(profile.agent_base_url, "https://platform.example.test/agent-service");
    assert.equal(profile.builtin, false);
  });
  await withEnv({ YAAIF_OIDC_AUTHORITY: "https://platform.yaaif.ai/auth/realms/yaaif", YAAIF_API_BASE_URL: "https://platform.yaaif.ai" }, async () => {
    assert.equal(lockedProfileFromConfig(loadConfig(CLI_CLIENT)).id, "hosted");
  });
});

test("a locked store refuses other profiles and edits of the locked one", async () => {
  const home = await mkdtemp(join(tmpdir(), "yaaif-lock-store-"));
  try {
    const store = new ProfileStore(home);
    await store.upsertCustom({ id: "agent-made", label: "x", oidc_authority: "https://wrong", api_base_url: "https://wrong",
      agent_base_url: "", control_plane_base_url: "", approval_base_url: "" });
    await store.setActive("agent-made");
    const locked = await store.lock({ id: "platform-example-test", label: "p", builtin: false,
      oidc_authority: "https://platform.example.test/auth/realms/yaaif", api_base_url: "https://platform.example.test",
      agent_base_url: "https://platform.example.test/agent-service", control_plane_base_url: "", approval_base_url: "" });
    assert.equal((await store.getActive())?.profile_id, locked.id, "the agent's active profile is replaced");
    await store.setActive(locked.id); // re-selecting it is fine
    await assert.rejects(store.setActive("agent-made"), PlatformLockedError);
    await assert.rejects(store.upsertCustom({ ...locked, api_base_url: "https://elsewhere" }), PlatformLockedError);
    await assert.rejects(store.deleteCustom(locked.id), PlatformLockedError);
    // Unrelated profiles can still be saved; they just cannot be activated.
    await store.upsertCustom({ id: "notes", label: "n", oidc_authority: "https://n", api_base_url: "https://n",
      agent_base_url: "", control_plane_base_url: "", approval_base_url: "" });
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("a sign-in saved under another name for the same issuer is reused", async () => {
  const home = await mkdtemp(join(tmpdir(), "yaaif-lock-adopt-"));
  try {
    const authority = "https://platform.example.test/auth/realms/yaaif";
    await SessionStore.forProfile(home, "other-issuer").save(session("other-issuer", "https://other/auth/realms/yaaif", "wrong"));
    await SessionStore.forProfile(home, "hosted-com").save(session("hosted-com", authority, "kept"));
    const store = SessionStore.forProfile(home, "platform-example-test");
    assert.equal(await adoptIssuerSession(home, store, "platform-example-test", authority), "hosted-com");
    const adopted = await store.load();
    assert.equal(adopted?.tokens.access_token, "kept");
    assert.equal(adopted?.profile_id, "platform-example-test");
    // A profile that has its own session keeps it.
    await SessionStore.forProfile(home, "newer").save(session("newer", authority, "newer"));
    assert.equal(await adoptIssuerSession(home, store, "platform-example-test", authority), null);
    assert.equal((await store.load())?.tokens.access_token, "kept");
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("a locked MCP keeps its platform through the tools agents misuse", async () => {
  const issuer = await fakeIssuer();
  const home = await mkdtemp(join(tmpdir(), "yaaif-lock-mcp-"));
  try {
    // An earlier session left an agent-made profile active.
    const profiles = new ProfileStore(home, "yaaif-cli");
    await profiles.upsertCustom({ id: "platform.example.test", label: "x", oidc_authority: issuer.origin, api_base_url: issuer.origin,
      agent_base_url: "", control_plane_base_url: "", approval_base_url: "" });
    await profiles.setActive("platform.example.test");
    await withEnv({ YAAIF_CLI_HOME: home, YAAIF_PLATFORM_LOCKED: "1", YAAIF_OIDC_AUTHORITY: issuer.authority, YAAIF_API_BASE_URL: issuer.origin }, async () => {
      const mcp = await openCliMcp();
      try {
        const lockedId = mcp.runtime.cfg.activeProfileId;
        assert.equal(lockedId, "p-127-0-0-1"); // profileIdFromHostname of the API host
        assert.equal(mcp.runtime.cfg.oidcAuthority, issuer.authority);

        const use = await callTool(mcp.client, "yaaif_platform_use", { profile_id: "platform.example.test" });
        assert.equal(use.isError, true);
        assert.match(JSON.stringify(use.content), /bound to .*no platform setup is needed/);

        const save = await callTool(mcp.client, "yaaif_platform_save", { id: "made-up", label: "x", oidc_authority: issuer.origin,
          api_base_url: issuer.origin, activate: true });
        assert.equal(save.isError, true);
        assert.equal(await profiles.get("made-up"), null, "a profile that could never be activated is not saved");

        const ensure = await callTool(mcp.client, "yaaif_ensure_session", { profile_id: "platform.example.test", login_if_needed: false });
        assert.equal(ensure.isError, undefined, JSON.stringify(ensure.content));
        const payload = ensure.structuredContent as Record<string, unknown>;
        assert.equal(payload.profile_id, lockedId);
        assert.equal(payload.profile_id_ignored, "platform.example.test");
        assert.equal(payload.platform_locked, true);
        assert.match(String(payload.next), /yaaif_login_device/);

        const list = await callTool(mcp.client, "yaaif_platform_list", {});
        assert.equal((list.structuredContent as Record<string, unknown>).locked_profile_id, lockedId);
        const active = JSON.parse(await readFile(join(home, "active-profile.json"), "utf8")) as { profile_id: string };
        assert.equal(active.profile_id, lockedId);
      } finally {
        await mcp.close();
      }
    });
  } finally {
    await issuer.close();
    await rm(home, { recursive: true, force: true });
  }
});
