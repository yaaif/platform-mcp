import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { clientDescriptor, type Config } from "../config.js";
import { AuthClient, BrowserLoginUnavailableError, browserLoginAvailable, openInBrowser } from "./oidc.js";
import { SessionStore } from "./store.js";

test("OpenCode runs on a server, so browser sign-in points to the device login", async () => {
  assert.equal(browserLoginAvailable({ client: clientDescriptor("opencode") }), false);
  assert.equal(browserLoginAvailable({ client: clientDescriptor("cursor") }), true);
  const home = await mkdtemp(join(tmpdir(), "yaaif-browser-login-"));
  try {
    const cfg = { client: clientDescriptor("opencode"), oidcAuthority: "http://127.0.0.1:9", stateHome: home } as unknown as Config;
    await assert.rejects(new AuthClient(cfg, new SessionStore(home)).login(), (error: unknown) => {
      assert.ok(error instanceof BrowserLoginUnavailableError);
      assert.match(String(error), /yaaif_login_device/);
      return true;
    });
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("a missing browser launcher is reported, not thrown", async () => {
  const saved = process.env.PATH;
  // No xdg-open or open on the path: the spawn fails with an "error" event.
  process.env.PATH = "/nonexistent";
  try {
    const failure = await new Promise<unknown>((resolve) => {
      openInBrowser("https://example.invalid/", resolve);
      setTimeout(() => resolve("no failure reported"), 3000).unref();
    });
    assert.notEqual(failure, "no failure reported");
  } finally {
    process.env.PATH = saved;
  }
});
