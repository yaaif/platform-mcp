import assert from "node:assert/strict";
import { test } from "node:test";
import { renderLoginCallbackPage } from "./callbackPage.js";

test("success page includes logo and issuer without host-app branding", () => {
  const html = renderLoginCallbackPage({
    ok: true,
    heading: "You're signed in",
    message: "Authentication finished successfully.",
    detail: "https://platform.yaaif.com/auth/realms/yaaif",
  });
  assert.match(html, /YAA\\F/);
  assert.match(html, /viewBox="0 0 1024 1024"/);
  assert.match(html, /You&#39;re signed in/);
  assert.match(html, /https:\/\/platform\.yaaif\.com\/auth\/realms\/yaaif/);
  assert.match(html, /close this window and continue/);
  assert.match(html, /class="ycb-ok"/);
  assert.doesNotMatch(html, /Claude Code/);
  assert.doesNotMatch(html, /return to Cursor/);
  assert.doesNotMatch(html, /return to Codex/);
  assert.doesNotMatch(html, /aria-label="Cursor"/);
  assert.doesNotMatch(html, /ycb-product/);
});

test("success page tries to close and includes a fallback when the browser blocks it", () => {
  const html = renderLoginCallbackPage({
    ok: true,
    heading: "You're signed in",
    message: "Authentication finished successfully.",
  });
  assert.doesNotMatch(html, /onclick="window\.close\(\)"/);
  assert.match(html, /function tryClose/);
  assert.doesNotMatch(html, /window\.open\("", "_self"\)/);
  assert.match(html, /showFallback/);
  assert.match(html, /Your browser will not close this tab/);
  assert.match(html, /Close it to continue/);
  assert.match(html, /tryClose\(\);/);
  assert.match(html, /id="ycb-close"/);
});

test("error page escapes untrusted text", () => {
  const html = renderLoginCallbackPage({
    ok: false,
    heading: "<script>alert(1)</script>",
    message: "oauth error: access_denied",
  });
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /class="ycb-err"/);
  assert.match(html, /Sign-in failed/);
});

test("error page keeps Close control but does not auto-close on load", () => {
  const html = renderLoginCallbackPage({
    ok: false,
    heading: "Sign-in was not completed",
    message: "The identity provider returned access_denied.",
  });
  assert.match(html, /id="ycb-close"/);
  assert.match(html, /function tryClose/);
  assert.match(html, /Your browser will not close this tab/);
  assert.doesNotMatch(html, /onclick="window\.close\(\)"/);
  const autoCloseOnLoad = html.match(/if \(closeBtn\) closeBtn\.addEventListener\("click", tryClose\);\s*tryClose\(\);/);
  assert.equal(autoCloseOnLoad, null);
});
