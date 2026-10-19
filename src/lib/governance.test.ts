import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Ctx } from "../tools/ctx.js";
import {
  identity,
  preview,
  apply,
  getProposal,
  governanceOperation,
  inspect,
  inspectPath,
  type GovernanceOperation,
} from "./governance.js";

async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const home = await mkdtemp(join(tmpdir(), "governance-test-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const session = {
    subject: "user",
    tenant_id: "tenant",
    profile_id: "test",
    tokens: { access_token: "private" },
  };
  let permissions = [
    "agent.guardrails.read",
    "agent.guardrails.write",
    "agent.agents.read",
    "agent.agents.write",
  ];
  let version = 1,
    writes = 0,
    failWrite = 0,
    accessFailure = false;
  const data: Record<string, unknown> = {
    "/api/guardrails/policies/p": {
      id: "p",
      name: "existing",
      version: 3,
      policy: {},
    },
    "/api/harness/settings": {
      defaults: { chat: { max_context_chars: 2000 } },
    },
    "/api/agents/a": { id: "a", guardrail_policy_id: "p" },
  };
  const calls: {
    method: string;
    path: string;
    body: unknown;
    headers?: Record<string, string>;
  }[] = [];
  const stamp = () => version.toString(16).padStart(64, "0");
  const ctx = {
    cfg: {
      stateHome: home,
      activeProfileId: "test",
      apiBaseUrl: "https://api",
      agentBaseUrl: "https://agent",
    },
    auth: { session: async () => session },
    api: {
      apiJSON: async () => {
        if (accessFailure) throw new Error("RBAC unavailable");
        return { tenant_id: session.tenant_id, permissions };
      },
      agentJSON: async (
        method: string,
        path: string,
        body?: Record<string, unknown>,
        opts?: {
          headers?: Record<string, string>;
          onResponse?: (res: Response) => void;
        },
      ) => {
        calls.push({ method, path, body, headers: opts?.headers });
        const key = path.split("?")[0];
        if (key.endsWith("/governance-state")) return { version: stamp() };
        if (key.endsWith("/validate")) {
          if (body?.policy && (body.policy as Record<string, unknown>).invalid)
            throw new Error("invalid policy");
          return { valid: true, defaults: body?.defaults };
        }
        if (method === "GET")
          return structuredClone(data[key] ?? { items: [] });
        if (opts?.headers?.["X-Governance-If-Match"] !== stamp())
          throw new Error("412 stale baseline");
        writes++;
        if (writes === failWrite) {
          opts?.onResponse?.(new Response("{}", { status: 400 }));
          throw new Error("backend failed");
        }
        version++;
        if (body) data[key] = { ...(data[key] as object), ...body };
        opts?.onResponse?.(
          new Response("{}", { headers: { "X-Governance-Version": stamp() } }),
        );
        return structuredClone(data[key] ?? { id: "created" });
      },
    },
  } as unknown as Ctx;
  return {
    ctx,
    calls,
    session,
    get writes() {
      return writes;
    },
    set permissions(v: string[]) {
      permissions = v;
    },
    set failWrite(v: number) {
      failWrite = v;
    },
    set accessFailure(v: boolean) {
      accessFailure = v;
    },
    externalChange() {
      version++;
    },
    home,
  };
}
const policy: GovernanceOperation = {
  action: "policy_update",
  id: "p",
  changes: { name: "reviewed" },
};

test("preview is non-mutating; confirmed apply uses reviewed content and never repeats", async (t) => {
  const f = await fixture(t);
  const p = await preview(f.ctx, await identity(f.ctx), [policy]);
  assert.equal(f.writes, 0);
  assert.deepEqual(p.steps[0].diff, [
    { path: "/name", before: "existing", after: "reviewed" },
  ]);
  await assert.rejects(
    apply(f.ctx, p.id, p.review_digest, false),
    /confirmation/,
  );
  assert.equal(f.writes, 0);
  const done = await apply(f.ctx, p.id, p.review_digest, true);
  assert.equal(done.status, "applied");
  assert.equal(f.writes, 1);
  const mutation = f.calls.find((c) => c.method === "PUT")!;
  assert.deepEqual(mutation.body, { name: "reviewed" });
  assert.equal(mutation.headers?.["If-Match"], "3");
  assert.equal(mutation.headers?.["X-Request-ID"], p.id);
  assert.ok(done.steps[0].verification);
  await apply(f.ctx, p.id, p.review_digest, true);
  assert.equal(f.writes, 1);
});
test("harness and agent assignments use validated typed updates", async (t) => {
  const f = await fixture(t);
  const p = await preview(f.ctx, await identity(f.ctx), [
    {
      action: "harness_update",
      defaults: { chat: { max_context_chars: 4000 } },
    },
    { action: "agent_policy_update", id: "a", guardrail_policy_id: "p" },
  ]);
  assert.equal(f.writes, 0);
  const result = await apply(f.ctx, p.id, p.review_digest, true);
  assert.equal(result.status, "applied");
  assert.equal(f.writes, 2);
  assert.ok(f.calls.some((c) => c.path === "/api/harness/settings/validate"));
});
test("permission discovery fails closed; readers inspect but cannot propose", async (t) => {
  const f = await fixture(t);
  f.accessFailure = true;
  await assert.rejects(identity(f.ctx), /RBAC/);
  f.accessFailure = false;
  f.permissions = ["agent.guardrails.read"];
  const who = await identity(f.ctx);
  await inspect(f.ctx, who, { resource: "policy", id: "p" });
  await assert.rejects(preview(f.ctx, who, [policy]), /Permission denied/);
  assert.equal(f.writes, 0);
  f.session.tokens.access_token = "";
  await assert.rejects(identity(f.ctx), /Authenticated/);
});
test("stale baseline, revoked access, profile and tenant changes cannot apply", async (t) => {
  const f = await fixture(t);
  const p = await preview(f.ctx, await identity(f.ctx), [policy]);
  f.externalChange();
  await assert.rejects(
    apply(f.ctx, p.id, p.review_digest, true),
    /changed after preview/,
  );
  assert.equal(f.writes, 0);
  f.session.tenant_id = "other";
  await assert.rejects(
    getProposal(f.ctx, await identity(f.ctx), p.id),
    /different identity/,
  );
  f.session.tenant_id = "tenant";
  f.ctx.cfg.activeProfileId = "other";
  await assert.rejects(
    getProposal(f.ctx, await identity(f.ctx), p.id),
    /different identity/,
  );
  f.ctx.cfg.activeProfileId = "test";
  f.permissions = ["agent.guardrails.read"];
  await assert.rejects(
    apply(f.ctx, p.id, p.review_digest, true),
    /Permission denied/,
  );
  assert.equal(f.writes, 0);
});
test("edited proposal or different review digest invalidates confirmation", async (t) => {
  const f = await fixture(t);
  const p = await preview(f.ctx, await identity(f.ctx), [policy]);
  await assert.rejects(apply(f.ctx, p.id, "0".repeat(64), true), /digest/);
  const path = join(f.home, "governance-proposals", `${p.id}.json`);
  const stored = JSON.parse(await readFile(path, "utf8"));
  stored.steps[0].operation.changes.name = "unreviewed";
  await writeFile(path, JSON.stringify(stored));
  await assert.rejects(apply(f.ctx, p.id, p.review_digest, true), /modified/);
  assert.equal(f.writes, 0);
});
test("partial failure stops subsequent writes and cannot replay operations", async (t) => {
  const f = await fixture(t);
  const p = await preview(f.ctx, await identity(f.ctx), [
    policy,
    { action: "budget_update", monthly_limit_usd: 100 },
    {
      action: "decision_engine_update",
      llm_model_config_id: "m",
      timeout_seconds: 15,
    },
  ]);
  f.failWrite = 2;
  const result = await apply(f.ctx, p.id, p.review_digest, true);
  assert.equal(result.status, "partial");
  assert.deepEqual(
    result.steps.map((s) => s.status),
    ["applied", "failed", "pending"],
  );
  assert.equal(f.writes, 2);
  await apply(f.ctx, p.id, p.review_digest, true);
  assert.equal(f.writes, 2);
});
test("rejects arbitrary writes, attribution, purges, invalid settings and traversal", async (t) => {
  for (const input of [
    { action: "harness_update", defaults: { unknown: {} } },
    { action: "policy_update", id: "p", changes: { updated_by: "admin" } },
    { action: "purge_user" },
    { action: "policy_update", id: "p", changes: { policy_file: "/secrets" } },
  ])
    assert.equal(governanceOperation.safeParse(input).success, false);
  const f = await fixture(t);
  await assert.rejects(
    preview(f.ctx, await identity(f.ctx), [
      { action: "policy_create", name: "bad", policy: { invalid: true } },
    ]),
    /invalid policy/,
  );
  assert.equal(f.writes, 0);
  await assert.rejects(
    getProposal(f.ctx, await identity(f.ctx), "../../secrets"),
    /Invalid proposal/,
  );
  assert.match(inspectPath({ resource: "policy", id: "../../escape" }), /%2F/);
});
test("external writes between operations are rejected rather than adopted", async (t) => {
  const f = await fixture(t);
  const original = f.ctx.api.agentJSON.bind(f.ctx.api);
  let readbacks = 0;
  f.ctx.api.agentJSON = async (...args: Parameters<typeof original>) => {
    const result = await original(...args);
    if (
      args[0] === "GET" &&
      args[1].startsWith("/api/guardrails/policies/p?") &&
      ++readbacks === 2
    )
      f.externalChange();
    return result;
  };
  const p = await preview(f.ctx, await identity(f.ctx), [
    policy,
    { action: "budget_update", monthly_limit_usd: 200 },
  ]);
  const result = await apply(f.ctx, p.id, p.review_digest, true);
  assert.equal(result.status, "partial");
  assert.equal(f.writes, 1);
});

test("a lost write response records uncertainty and never resubmits", async (t) => {
  const f = await fixture(t);
  const p = await preview(f.ctx, await identity(f.ctx), [policy]);
  const original = f.ctx.api.agentJSON.bind(f.ctx.api);
  f.ctx.api.agentJSON = async (...args: Parameters<typeof original>) => {
    const result = await original(...args);
    if (args[0] === "PUT") throw new Error("connection lost after write");
    return result;
  };
  const result = await apply(f.ctx, p.id, p.review_digest, true);
  assert.equal(result.status, "needs_review");
  assert.equal(result.steps[0].status, "uncertain");
  await apply(f.ctx, p.id, p.review_digest, true);
  assert.equal(f.writes, 1);
});
