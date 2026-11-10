import assert from "node:assert/strict";
import test from "node:test";
import type { ApiClient } from "../client/http.js";
import { collectFeatureCapabilities, probeFeature } from "./featureProbes.js";

function apiWith(path: string, error?: string): ApiClient {
  const call = async (_method: string, calledPath: string) => {
    assert.equal(calledPath, path);
    if (error) throw new Error(error);
    return { items: [] };
  };
  return { agentJSON: call, apiJSON: call } as unknown as ApiClient;
}

test("feature probe distinguishes accessible, permission, missing and transport failures", async () => {
  assert.equal((await probeFeature(apiWith("/api/wiki/pages?limit=1"), "wiki")).status, "available");
  const denied = await probeFeature(apiWith("/api/wiki/pages?limit=1", "GET /api/wiki/pages?limit=1 failed (403): forbidden"), "wiki");
  assert.equal(denied.status, "permission_denied");
  assert.equal(denied.supported, true);
  assert.equal(denied.accessible, false);
  const missing = await probeFeature(apiWith("/api/platform-updates/status", "GET /api/platform-updates/status failed (404): not found"), "platform_updates");
  assert.equal(missing.status, "unavailable");
  assert.equal(missing.supported, false);
  const transport = await probeFeature(apiWith("/api/agents?limit=1", "socket disconnected"), "agents");
  assert.equal(transport.status, "error");
});

test("capability collection checks every feature without writes", async () => {
  const calls: string[] = [];
  const api = {
    agentJSON: async (method: string, path: string) => {
      assert.equal(method, "GET");
      calls.push(path);
      if (path.includes("agent-specs")) throw new Error("GET failed (403): forbidden");
      return {};
    },
    apiJSON: async (method: string, path: string) => {
      assert.equal(method, "GET");
      calls.push(path);
      return {};
    },
  } as unknown as ApiClient;
  const result = await collectFeatureCapabilities(api);
  assert.equal(calls.length, 5);
  assert.equal(result.all_supported, true);
  assert.equal(result.all_accessible, false);
  assert.equal(result.features.scenarios.status, "permission_denied");
  assert.equal(result.features.credentials.status, "available");
});
