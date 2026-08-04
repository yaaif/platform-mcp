/**
 * Optional live smoke: set YAAIF_INTEGRATION=1 and a valid session/profile.
 * Default run is skipped so CI stays offline.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../config.js";

async function sessionHeaders(cfg: ReturnType<typeof loadConfig>) {
  const raw = await readFile(join(homedir(), ".yaaif/cursor/session.json"), "utf8");
  const sess = JSON.parse(raw) as {
    tokens?: { access_token?: string };
    tenant_id?: string;
  };
  const token = sess.tokens?.access_token;
  const tenant = sess.tenant_id || cfg.defaultTenantId;
  assert.ok(token, "missing access_token in ~/.yaaif/cursor/session.json");
  assert.ok(tenant, "missing tenant_id");
  return {
    Authorization: `Bearer ${token}`,
    "X-Tenant-ID": tenant,
    "Content-Type": "application/json",
  };
}

test("integration catalog ping (optional)", async (t) => {
  if (process.env.YAAIF_INTEGRATION !== "1") {
    t.skip("Set YAAIF_INTEGRATION=1 with an authenticated ~/.yaaif/cursor session to run");
    return;
  }
  const cfg = loadConfig();
  const res = await fetch(`${cfg.apiBaseUrl}/health`);
  assert.ok(res.status > 0);
});

test("integration local-tools list + smoke call (optional)", async (t) => {
  if (process.env.YAAIF_INTEGRATION !== "1") {
    t.skip("Set YAAIF_INTEGRATION=1 with an authenticated ~/.yaaif/cursor session to run");
    return;
  }
  const cfg = loadConfig();
  const headers = await sessionHeaders(cfg);
  const listRes = await fetch(`${cfg.agentBaseUrl}/api/local-tools?names_only=true&family=skill`, {
    headers,
  });
  assert.equal(listRes.status, 200, await listRes.text());
  const list = (await listRes.json()) as { names?: string[]; total?: number };
  assert.ok((list.names?.length ?? 0) > 0 || (list.total ?? 0) > 0, "expected local skill tools");

  const callRes = await fetch(`${cfg.agentBaseUrl}/api/local-tools/list_ambient_workflows/call`, {
    method: "POST",
    headers,
    body: JSON.stringify({ arguments: {} }),
  });
  assert.ok(callRes.status < 500, await callRes.text());
});

test("integration ops correlate without seed returns 400 (optional)", async (t) => {
  if (process.env.YAAIF_INTEGRATION !== "1") {
    t.skip("Set YAAIF_INTEGRATION=1 with an authenticated ~/.yaaif/cursor session to run");
    return;
  }
  const cfg = loadConfig();
  const headers = await sessionHeaders(cfg);
  const res = await fetch(`${cfg.agentBaseUrl}/api/ops/correlate`, { headers });
  assert.equal(res.status, 400, await res.text());
});

test("integration ops telemetry flow-events without request_id returns 400 (optional)", async (t) => {
  if (process.env.YAAIF_INTEGRATION !== "1") {
    t.skip("Set YAAIF_INTEGRATION=1 with an authenticated ~/.yaaif/cursor session to run");
    return;
  }
  const cfg = loadConfig();
  const headers = await sessionHeaders(cfg);
  const res = await fetch(`${cfg.agentBaseUrl}/api/ops/flow-events`, { headers });
  // 400 = mounted; 403 = mounted but missing api.metrics.read
  assert.ok([400, 403].includes(res.status), await res.text());
});
