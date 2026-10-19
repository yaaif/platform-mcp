import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { ApiClient } from "./http.js";
import type { AuthClient } from "../auth/oidc.js";
import type { Config } from "../config.js";

async function client(
  t: { after(fn: () => Promise<void>): void },
  handler: Parameters<typeof createServer>[0],
) {
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return new ApiClient(
    { agentBaseUrl: url } as Config,
    {
      accessToken: async () => ({
        token: "real-token",
        session: { tenant_id: "real-tenant" },
      }),
    } as unknown as AuthClient,
  );
}

test("conditional headers and post-write tokens survive HTTP without replacing identity", async (t) => {
  let version = "";
  const api = await client(t, (req, res) => {
    req.resume();
    req.on("end", () => {
      assert.equal(req.headers.authorization, "Bearer real-token");
      assert.equal(req.headers["x-tenant-id"], "real-tenant");
      assert.equal(req.headers["x-governance-if-match"], "reviewed");
      assert.equal(req.headers["if-match"], "3");
      res.writeHead(200, {
        "content-type": "application/json",
        "X-Governance-Version": "next",
      });
      res.end('{"saved":true}');
    });
  });
  const result = await api.agentJSON(
    "PUT",
    "/policy",
    {},
    {
      headers: {
        authorization: "spoofed",
        "x-tenant-id": "other",
        "X-Governance-If-Match": "reviewed",
        "If-Match": "3",
      },
      onResponse: (r) => {
        version = r.headers.get("X-Governance-Version") || "";
      },
    },
  );
  assert.deepEqual(result, { saved: true });
  assert.equal(version, "next");
});

test("a conditional write is not retried after losing a reused socket response", async (t) => {
  let writes = 0;
  const api = await client(t, (req, res) => {
    req.resume();
    req.on("end", () => {
      if (req.method === "PUT") {
        writes++;
        req.socket.destroy();
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end("{}");
    });
  });
  await api.agentJSON("GET", "/warm");
  await assert.rejects(
    api.agentJSON(
      "PUT",
      "/policy",
      {},
      { headers: { "X-Governance-If-Match": "reviewed" } },
    ),
  );
  assert.equal(writes, 1);
});

test("a changed session is rejected before dispatching a reviewed write", async (t) => {
  let requests = 0;
  const api = await client(t, (_req, res) => {
    requests++;
    res.end("{}");
  });
  await assert.rejects(
    api.agentJSON(
      "PUT",
      "/policy",
      {},
      {
        expectedContext: {
          subject: "original-user",
          tenant: "real-tenant",
          profile: "default",
          origin: "original-platform",
        },
        headers: { "X-Governance-If-Match": "reviewed" },
      },
    ),
    /changed before request dispatch/,
  );
  assert.equal(requests, 0);
});
