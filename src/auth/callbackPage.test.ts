import assert from "node:assert/strict";
import { test } from "node:test";
import { renderLoginCallbackPage } from "./callbackPage.js";

test("success page includes logo, issuer, and Cursor copy", () => {
  const html = renderLoginCallbackPage({
    ok: true,
    heading: "You're signed in",
    message: "Authentication finished successfully.",
    detail: "https://platform.yaaif.com/auth/realms/yaaif",
    returnTo: "Cursor",
  });
  assert.match(html, /YAA\\F/);
  assert.match(html, /viewBox="0 0 1024 1024"/);
  assert.match(html, /You&#39;re signed in/);
  assert.match(html, /https:\/\/platform\.yaaif\.com\/auth\/realms\/yaaif/);
  assert.match(html, /return to Cursor/);
  assert.match(html, /class="ycb-ok"/);
  assert.match(html, /viewBox="0 0 466.73 532.09"/);
  assert.match(html, /aria-label="Cursor"/);
});

test("error page escapes untrusted text", () => {
  const html = renderLoginCallbackPage({
    ok: false,
    heading: "<script>alert(1)</script>",
    message: "oauth error: access_denied",
    returnTo: "Cursor",
  });
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /class="ycb-err"/);
  assert.match(html, /Sign-in failed/);
});

test("Codex callback page uses Codex return copy without Cursor branding", () => {
  const html = renderLoginCallbackPage({
    ok: true,
    heading: "You're signed in",
    message: "Authentication finished successfully.",
    returnTo: "Codex",
  });
  assert.match(html, /return to Codex/);
  assert.doesNotMatch(html, /aria-label="Cursor"/);
});
