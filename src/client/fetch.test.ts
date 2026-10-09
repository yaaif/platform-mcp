import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { yaaifFetch } from "./tls.js";

async function serve(handler: (call: number) => number) {
  let calls = 0;
  let connections = 0;
  const server: Server = createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      const status = handler(++calls);
      res.writeHead(status, { "content-type": "text/plain" });
      res.end(String(status));
    });
  });
  server.on("connection", () => connections++);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/x`,
    calls: () => calls,
    connections: () => connections,
    close: async () => {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

test("GET retries a gateway error and then succeeds", async () => {
  const s = await serve((call) => (call === 1 ? 503 : 200));
  try {
    const res = await yaaifFetch(s.url);
    assert.equal(res.status, 200);
    assert.equal(s.calls(), 2);
  } finally {
    await s.close();
  }
});

test("POST is not retried after a gateway error", async () => {
  const s = await serve(() => 503);
  try {
    const res = await yaaifFetch(s.url, { method: "POST", body: "{}" });
    assert.equal(res.status, 503);
    assert.equal(s.calls(), 1);
  } finally {
    await s.close();
  }
});

test("GET gives up after the retry budget and returns the last response", async () => {
  const s = await serve(() => 502);
  try {
    const res = await yaaifFetch(s.url);
    assert.equal(res.status, 502);
    assert.equal(s.calls(), 3);
  } finally {
    await s.close();
  }
});

test("sequential requests reuse one connection", async () => {
  const s = await serve(() => 200);
  try {
    await yaaifFetch(s.url);
    await yaaifFetch(s.url);
    await yaaifFetch(s.url, { method: "POST", body: "{}" });
    assert.equal(s.calls(), 3);
    assert.equal(s.connections(), 1);
  } finally {
    await s.close();
  }
});
