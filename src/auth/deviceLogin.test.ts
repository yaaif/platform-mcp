import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { clientDescriptor, type Config } from "../config.js";
import { AuthClient } from "./oidc.js";
import { SessionStore } from "./store.js";

// A Keycloak stand-in: device codes live 5 s, tokens are issued once approved.
async function fakeKeycloak() {
  const state = { starts: 0, polls: 0, approved: false };
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      res.setHeader("content-type", "application/json");
      if (req.url?.endsWith("/auth/device")) {
        state.starts += 1;
        res.end(JSON.stringify({ device_code: `dc-${state.starts}`, user_code: `CODE-${state.starts}`,
          verification_uri: "http://kc/device", expires_in: 5, interval: 0.05 }));
        return;
      }
      if (req.url?.endsWith("/token")) {
        state.polls += 1;
        if (!state.approved) { res.statusCode = 400; res.end(JSON.stringify({ error: "authorization_pending" })); return; }
        res.end(JSON.stringify({ access_token: "at", refresh_token: "rt", token_type: "Bearer", expires_in: 300 }));
        return;
      }
      res.statusCode = 404; res.end("{}");
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const authority = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { state, authority, close: () => new Promise<void>((r) => { server.closeAllConnections(); server.close(() => r()); }) };
}

async function client(authority: string) {
  const home = await mkdtemp(join(tmpdir(), "yaaif-device-login-"));
  const cfg = { client: clientDescriptor("opencode"), oidcAuthority: authority, oidcClientId: "yaaif-opencode",
    oidcScopes: ["openid"], stateHome: home } as unknown as Config;
  const auth = new AuthClient(cfg, new SessionStore(home));
  auth.minPollSec = 0;
  return { auth, home };
}

test("a code shown with a short timeout_ms is still collected when the user approves later", async () => {
  const kc = await fakeKeycloak();
  const { auth, home } = await client(kc.authority);
  try {
    const first = await auth.deviceLogin({ wait: false, timeout_ms: 1 });
    assert.equal(first.status, "pending");
    await new Promise((r) => setTimeout(r, 300)); // far past timeout_ms
    kc.state.approved = true;
    const done = await auth.deviceLogin({ wait: true, timeout_ms: 3000 });
    assert.equal(done.status, "complete");
    assert.equal(done.user_code, first.user_code);
    assert.equal(kc.state.starts, 1, "no second code was started");
  } finally {
    await kc.close();
    await rm(home, { recursive: true, force: true });
  }
});

test("a wait that runs out reports the same code pending instead of abandoning it", async () => {
  const kc = await fakeKeycloak();
  const { auth, home } = await client(kc.authority);
  try {
    const waited = await auth.deviceLogin({ wait: true, timeout_ms: 200 });
    assert.equal(waited.status, "pending");
    assert.ok(waited.expires_at);
    kc.state.approved = true;
    const done = await auth.deviceLogin({ wait: true, timeout_ms: 3000 });
    assert.equal(done.status, "complete");
    assert.equal(done.user_code, waited.user_code);
    assert.equal(kc.state.starts, 1);
  } finally {
    await kc.close();
    await rm(home, { recursive: true, force: true });
  }
});

test("a profile switch stops the old login: it saves nothing and logs no failure", async () => {
  const kc = await fakeKeycloak();
  const { auth, home } = await client(kc.authority);
  const logged: string[] = [];
  const saved = console.error;
  console.error = (...args: unknown[]) => { logged.push(args.map(String).join(" ")); };
  try {
    const first = await auth.deviceLogin({ wait: false, timeout_ms: 1 });
    assert.equal(first.status, "pending");
    await auth.useProfile("other-profile");
    kc.state.approved = true; // the old code is approved after the switch
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(await auth.session(), null, "no tokens from the abandoned login");
    assert.deepEqual(logged.filter((line) => line.includes("device login poll failed")), []);
    const polls = kc.state.polls;
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(kc.state.polls, polls, "the old poll stopped");
  } finally {
    console.error = saved;
    await kc.close();
    await rm(home, { recursive: true, force: true });
  }
});

// The demo session of 2026-11-13: tools switched profiles by applying one to
// cfg, while the session store stayed on the old profile.
async function profileClient(authority: string, profileId: string) {
  const home = await mkdtemp(join(tmpdir(), "yaaif-device-profile-"));
  const cfg = { client: clientDescriptor("opencode"), oidcAuthority: authority, oidcClientId: "yaaif-opencode",
    oidcScopes: ["openid"], stateHome: home, activeProfileId: profileId } as unknown as Config;
  const auth = new AuthClient(cfg, SessionStore.forProfile(home, profileId));
  auth.minPollSec = 0;
  return { auth, cfg, home };
}

test("a profile applied to cfg reads that profile's saved session", async () => {
  const { auth, cfg, home } = await profileClient("http://127.0.0.1:9", "wrong");
  try {
    await SessionStore.forProfile(home, "hosted-com").save({
      tokens: { access_token: "kept", refresh_token: "rt", token_type: "Bearer", expiry: new Date(Date.now() + 3_600_000).toISOString() },
      profile_id: "hosted-com",
      oidc_authority: "http://kc/realms/yaaif",
    });
    // ensure_session profile_id=… and platform_save activate=true only apply the profile to cfg.
    cfg.activeProfileId = "hosted-com";
    cfg.oidcAuthority = "http://kc/realms/yaaif";
    assert.equal((await auth.session())?.tokens.access_token, "kept");
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("an approved code saves to the profile it was started for", async () => {
  const kc = await fakeKeycloak();
  const { auth, cfg, home } = await profileClient(kc.authority, "hosted-com");
  try {
    const first = await auth.deviceLogin({ wait: false });
    assert.equal(first.status, "pending");
    kc.state.approved = true;
    const done = await auth.deviceLogin({ wait: true, timeout_ms: 3000 });
    assert.equal(done.status, "complete");
    const saved = await SessionStore.forProfile(home, "hosted-com").load();
    assert.equal(saved?.tokens.access_token, "at");
    assert.equal(saved?.oidc_authority, kc.authority);
    assert.equal(cfg.activeProfileId, "hosted-com");
  } finally {
    await kc.close();
    await rm(home, { recursive: true, force: true });
  }
});

test("re-selecting the active profile keeps the code the user is approving", async () => {
  const kc = await fakeKeycloak();
  const { auth, home } = await profileClient(kc.authority, "hosted-com");
  try {
    const first = await auth.deviceLogin({ wait: false });
    await auth.useProfile("hosted-com"); // platform_use in parallel with login_device
    kc.state.approved = true;
    const done = await auth.deviceLogin({ wait: true, timeout_ms: 3000 });
    assert.equal(done.status, "complete");
    assert.equal(done.user_code, first.user_code);
    assert.equal(kc.state.starts, 1, "no new code");
    assert.equal((await auth.session())?.tokens.access_token, "at");
  } finally {
    await kc.close();
    await rm(home, { recursive: true, force: true });
  }
});

test("an authority that is not a Keycloak realm fails with a clear message", async () => {
  const server = http.createServer((req, res) => { res.statusCode = 404; res.end("404 page not found"); });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { auth, home } = await profileClient(`http://127.0.0.1:${(server.address() as AddressInfo).port}`, "bad");
  try {
    await assert.rejects(auth.deviceLogin({ wait: true, timeout_ms: 100 }), (error: Error) => {
      assert.doesNotMatch(error.message, /Unexpected end of JSON/);
      assert.match(error.message, /\(404\).*oidc_authority.*auth\/realms/s);
      return true;
    });
  } finally {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
    await rm(home, { recursive: true, force: true });
  }
});
