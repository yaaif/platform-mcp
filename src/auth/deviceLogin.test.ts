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
