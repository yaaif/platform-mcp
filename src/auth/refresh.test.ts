import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { Config } from "../config.js";
import { AuthClient, ReauthRequiredError } from "./oidc.js";
import { SessionStore, type Session } from "./store.js";

type Handler = (call: number) => { status: number; body: string };

async function fixture(handler: Handler, session?: Partial<Session["tokens"]>) {
  let calls = 0;
  const server: Server = createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      const out = handler(++calls);
      res.writeHead(out.status, { "content-type": "application/json" });
      res.end(out.body);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const authority = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const home = await mkdtemp(join(tmpdir(), "yaaif-refresh-"));
  const store = new SessionStore(home);
  await store.ensureHome(home);
  await store.save({
    tokens: {
      access_token: "old-access",
      refresh_token: "old-refresh",
      expiry: new Date(Date.now() - 1000).toISOString(),
      ...session,
    },
    oidc_authority: authority,
    tenant_id: "t1",
  });
  const cfg = { oidcAuthority: authority, oidcClientId: "test", stateHome: home } as unknown as Config;
  return {
    auth: new AuthClient(cfg, store),
    store,
    calls: () => calls,
    close: async () => {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      await rm(home, { recursive: true, force: true });
    },
  };
}

const ok: Handler = () => ({
  status: 200,
  body: JSON.stringify({ access_token: "new-access", refresh_token: "new-refresh", expires_in: 3600 }),
});

test("parallel callers share one refresh", async () => {
  const f = await fixture(ok);
  try {
    const results = await Promise.all([f.auth.accessToken(), f.auth.accessToken(), f.auth.accessToken()]);
    assert.equal(f.calls(), 1);
    assert.deepEqual(results.map((r) => r.token), ["new-access", "new-access", "new-access"]);
  } finally {
    await f.close();
  }
});

test("a gateway error during refresh keeps the saved session", async () => {
  const f = await fixture(() => ({ status: 502, body: "<html>bad gateway</html>" }));
  try {
    await assert.rejects(f.auth.accessToken(), (err: Error) => {
      assert.ok(!(err instanceof ReauthRequiredError));
      assert.match(err.message, /temporarily failed/);
      return true;
    });
    assert.equal((await f.store.load())?.tokens.refresh_token, "old-refresh");
  } finally {
    await f.close();
  }
});

test("a rejected refresh token clears the session and asks for login", async () => {
  const f = await fixture(() => ({ status: 400, body: JSON.stringify({ error: "invalid_grant" }) }));
  try {
    await assert.rejects(f.auth.accessToken(), ReauthRequiredError);
    assert.equal(await f.store.load(), null);
  } finally {
    await f.close();
  }
});

test("a rejection after another process already refreshed uses the newer session", async () => {
  const f = await fixture(() => ({ status: 400, body: JSON.stringify({ error: "invalid_grant" }) }));
  try {
    // Simulate a sibling MCP process saving rotated tokens while we were rejected.
    const original = f.store.load.bind(f.store);
    let first = true;
    f.store.load = async () => {
      if (first) {
        first = false;
        return original();
      }
      return {
        tokens: { access_token: "sibling-access", refresh_token: "sibling-refresh", expiry: new Date(Date.now() + 3_600_000).toISOString() },
        tenant_id: "t1",
      };
    };
    const { token } = await f.auth.accessToken();
    assert.equal(token, "sibling-access");
  } finally {
    await f.close();
  }
});
