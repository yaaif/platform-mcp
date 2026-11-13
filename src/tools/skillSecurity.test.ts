import { z } from "zod";
import test from "node:test";
import assert from "node:assert/strict";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Ctx } from "./ctx.js";
import { registerLocalTools } from "./registerLocalTools.js";

function fixture() {
  const handlers = new Map<
    string,
    (args: Record<string, unknown>) => Promise<unknown>
  >();
  const calls: unknown[][] = [];
  const schemas = new Map<string, Record<string, z.ZodTypeAny>>();
  const server = {
    registerTool(
      name: string,
      _config: unknown,
      handler: (args: Record<string, unknown>) => Promise<unknown>,
    ) {
      handlers.set(name, handler);
      schemas.set(
        name,
        (_config as { inputSchema: Record<string, z.ZodTypeAny> }).inputSchema,
      );
    },
  };
  const ctx = {
    cfg: { client: { label: "Test" }, stateHome: "/tmp/yaaif-test" },
    api: {
      async agentJSON(...args: unknown[]) {
        calls.push(args);
        return { id: "scan-a" };
      },
    },
  };
  registerLocalTools(server as unknown as McpServer, ctx as unknown as Ctx);
  return { handlers, calls, schemas };
}

test("security scans preserve branch identity and cannot activate skills", async () => {
  const { handlers, calls } = fixture();
  await handlers.get("yaaif_skill_security_scan")!({
    branch: "agents/example",
    workspace_fingerprint: "revision",
  });
  assert.deepEqual(calls, [
    [
      "POST",
      "/api/skills/security/scans?branch=agents%2Fexample",
      { workspace_fingerprint: "revision" },
    ],
  ]);
});

test("security reports are read-only and encode identifiers", async () => {
  const { handlers, calls } = fixture();
  await handlers.get("yaaif_skill_security_report")!({ scan_id: "scan/id" });
  await handlers.get("yaaif_skill_security_report")!({});
  assert.deepEqual(calls, [
    ["GET", "/api/skills/security/scans/scan%2Fid"],
    ["GET", "/api/skills/security"],
  ]);
});

import { ApiContextChangedError, ApiHttpError } from "../client/http.js";
import { registerSkillSecurityTools } from "./registerSkillSecurity.js";
import { OPENCODE_TOOL_ALLOWLIST_SET } from "./opencodeAllowlist.js";

type Result = { isError?: boolean; structuredContent?: Record<string, any> };
function securityFixture(
  respond: (...args: any[]) => Promise<unknown> = async () => ({}),
) {
  const handlers = new Map<string, (args: any) => Promise<Result>>();
  const calls: any[][] = [];
  const server = {
    registerTool(
      name: string,
      _config: unknown,
      handler: (args: any) => Promise<Result>,
    ) {
      handlers.set(name, handler);
    },
  };
  const ctx = {
    cfg: {
      agentBaseUrl: "https://agent.invalid",
      apiBaseUrl: "https://api.invalid",
      activeProfileId: "test",
    },
    auth: {
      async accessToken() {
        return { session: { subject: "user", tenant_id: "tenant-a" } };
      },
    },
    api: {
      async agentJSON(...args: any[]) {
        calls.push(args);
        return respond(...args);
      },
    },
  };
  registerSkillSecurityTools(
    server as unknown as McpServer,
    ctx as unknown as Ctx,
  );
  return {
    calls,
    run: (args: any) => handlers.get("yaaif_skill_security")!(args),
  };
}
const expectedContext = {
  subject: "user",
  tenant: "tenant-a",
  profile: "test",
  origin: "https://api.invalid|https://agent.invalid",
};
const validation = {
  branch: "team/fix",
  status: "FAILED",
  failure_count: 1,
  warning_count: 1,
  workspace_fingerprint: "current",
  issues: [
    { path: "example/SKILL.md", message: "missing name", severity: "ERROR" },
    { path: "example/SKILL.md", message: "add examples", severity: "WARNING" },
  ],
  failures: [{ path: "example/SKILL.md", message: "missing name" }],
};
const fix = {
  action: "fix",
  branch: "team/fix",
  path: "example/SKILL.md",
  content: "fixed content",
  if_match: 'W/"original"',
};

test("unified security workflow is available to OpenCode without increasing its tool budget", () => {
  assert.ok(OPENCODE_TOOL_ALLOWLIST_SET.has("yaaif_skill_security"));
  assert.ok(OPENCODE_TOOL_ALLOWLIST_SET.size <= 120);
});
test("diagnostics preserve branch, deduplicate failures and paginate without raw report blobs", async () => {
  const { run, calls } = securityFixture(async () => validation);
  const result = await run({
    action: "diagnose",
    branch: "team/fix",
    severity: "ERROR",
    limit: 1,
    offset: 0,
  });
  assert.deepEqual(calls, [
    [
      "POST",
      "/api/skills/validate?branch=team%2Ffix",
      { strict: false },
      { expectedContext },
    ],
  ]);
  assert.equal(result.structuredContent!.total, 1);
  assert.equal(result.structuredContent!.issues[0].message, "missing name");
  assert.equal(result.structuredContent!.security_checked, false);
  assert.equal(result.structuredContent!.validation.issues, undefined);
});
test("a security report from another branch cannot be mixed into repair evidence", async () => {
  const { run } = securityFixture(async (method) =>
    method === "POST" ? validation : { ref: "other", status: "blocked" },
  );
  const result = await run({
    action: "plan",
    branch: "team/fix",
    scan_id: "scan-a",
  });
  assert.equal(result.isError, true);
  assert.equal(result.structuredContent!.error_code, "branch_mismatch");
});
test("repair plans distinguish historical security evidence and keep the requested improvement", async () => {
  const { run, calls } = securityFixture(async (method) =>
    method === "POST"
      ? validation
      : {
          ref: "team/fix",
          status: "blocked",
          workspace_fingerprint: "old",
          report: {
            complete: true,
            issues: [
              {
                id: "exfil",
                severity: "HIGH",
                explanation: "risky command",
                remediation: "remove remote execution",
                location: { file: "example/run.py", start_line: 2 },
              },
            ],
          },
        },
  );
  const result = await run({
    action: "plan",
    branch: "team/fix",
    scan_id: "scan/a",
    goal: "Improve documentation",
  });
  assert.equal(
    result.structuredContent!.security_evidence_matches_workspace,
    false,
  );
  assert.equal(result.structuredContent!.issues.length, 3);
  assert.deepEqual(result.structuredContent!.plan.affected_files, [
    "example/SKILL.md",
    "example/run.py",
  ]);
  assert.equal(
    result.structuredContent!.plan.requested_improvement,
    "Improve documentation",
  );
  assert.equal(calls[1][1], "/api/skills/security/scans/scan%2Fa");
  assert.ok(calls.every(([method]) => method === "GET" || method === "POST"));
});
test("fix defaults to a preview and never writes", async () => {
  const { run, calls } = securityFixture(async () => ({
    etag: fix.if_match,
    content: "original",
  }));
  const result = await run(fix);
  assert.equal(result.structuredContent!.dry_run, true);
  assert.equal(result.structuredContent!.applied, false);
  assert.equal(calls.length, 1);
  assert.equal(
    calls[0][1],
    "/api/skill-files/content?path=example%2FSKILL.md&branch=team%2Ffix",
  );
});
test("file fixes reject missing acknowledgement, unsafe paths, missing branch and wildcard etags before HTTP", async () => {
  for (const args of [
    { ...fix, dry_run: false },
    { ...fix, path: "../escape" },
    { ...fix, path: "a/.git/config" },
    { ...fix, path: "C:/escape" },
    { ...fix, branch: "" },
    { ...fix, if_match: "*" },
  ]) {
    const { run, calls } = securityFixture();
    assert.equal((await run(args)).isError, true);
    assert.equal(calls.length, 0);
  }
});
test("stale etags never overwrite the concurrent editor", async () => {
  const { run, calls } = securityFixture(async () => ({
    etag: 'W/"newer"',
    content: "newer",
  }));
  const result = await run({ ...fix, dry_run: false, allow_mutating: true });
  assert.equal(result.structuredContent!.applied, false);
  assert.equal(result.structuredContent!.error_code, "file_conflict");
  assert.equal(calls.length, 1);
});
test("applying a reviewed fix sends If-Match and validates the same branch without publishing", async () => {
  const { run, calls } = securityFixture(async (method) =>
    method === "GET"
      ? { etag: fix.if_match, content: "original" }
      : method === "PUT"
        ? { etag: 'W/"updated"' }
        : validation,
  );
  const result = await run({ ...fix, dry_run: false, allow_mutating: true });
  assert.equal(result.structuredContent!.applied, true);
  assert.deepEqual(calls[1], [
    "PUT",
    "/api/skill-files/content?branch=team%2Ffix",
    { path: fix.path, content: fix.content },
    { expectedContext, headers: { "If-Match": fix.if_match } },
  ]);
  assert.deepEqual(calls[2], [
    "POST",
    "/api/skills/validate?branch=team%2Ffix",
    { strict: false },
    { expectedContext },
  ]);
  assert.equal(calls.length, 3);
});
test("post-write validation failure reports the partial success truthfully", async () => {
  const { run } = securityFixture(async (method) => {
    if (method === "GET") return { etag: fix.if_match, content: "original" };
    if (method === "PUT") return { etag: 'W/"updated"' };
    throw new ApiHttpError("validation unavailable", 503);
  });
  const result = await run({ ...fix, dry_run: false, allow_mutating: true });
  assert.equal(result.isError, true);
  assert.equal(result.structuredContent!.applied, true);
  assert.equal(result.structuredContent!.validation_failed, true);
});
test("lost write responses report an unknown outcome instead of inviting a blind retry", async () => {
  const { run } = securityFixture(async (method) => {
    if (method === "GET") return { etag: fix.if_match, content: "original" };
    throw new Error("connection lost after request");
  });
  const result = await run({ ...fix, dry_run: false, allow_mutating: true });
  assert.equal(result.structuredContent!.applied, "unknown");
  assert.match(result.structuredContent!.next_step, /Re-read the file/);
});
test("rejected scans retain actionable validation details beyond the bounded HTTP message", async () => {
  const details = Array.from(
    { length: 9 },
    (_, i) => `example/${i}/SKILL.md: required field missing`,
  );
  const { run } = securityFixture(async () => {
    throw new ApiHttpError("scan failed", 422, {
      error_code: "skill_structure_invalid",
      details,
      files: ["example/0/SKILL.md"],
    });
  });
  const result = await run({ action: "scan", branch: "team/fix" });
  assert.equal(result.isError, true);
  assert.equal(result.structuredContent!.error_code, "skill_structure_invalid");
  assert.deepEqual(result.structuredContent!.details, details);
});

test("improvement plans keep an explicitly selected healthy file in scope", async () => {
  const { run } = securityFixture(async () => validation);
  const result = await run({
    action: "plan",
    branch: "team/fix",
    path: "docs/SKILL.md",
    goal: "Improve examples",
  });
  assert.deepEqual(result.structuredContent!.issues, []);
  assert.deepEqual(result.structuredContent!.plan.affected_files, [
    "docs/SKILL.md",
  ]);
});

test("authentication context changes reject a fix before it can write to another tenant", async () => {
  const { run, calls } = securityFixture(async (method) => {
    if (method === "GET") return { etag: fix.if_match, content: "original" };
    throw new ApiContextChangedError();
  });
  const result = await run({ ...fix, dry_run: false, allow_mutating: true });
  assert.equal(result.isError, true);
  assert.equal(result.structuredContent!.applied, false);
  assert.deepEqual(calls[0][3], { expectedContext });
  assert.deepEqual(calls[1][3], {
    expectedContext,
    headers: { "If-Match": fix.if_match },
  });
});

test("diagnostics reject a platform response for the wrong requested branch", async () => {
  const { run } = securityFixture(async () => ({
    ...validation,
    branch: "main",
  }));
  const result = await run({ action: "diagnose", branch: "team/fix" });
  assert.equal(result.isError, true);
  assert.equal(result.structuredContent!.error_code, "branch_mismatch");
});

test("legacy scan/report aliases preserve empty default-scope inputs", async () => {
  const { handlers, calls, schemas } = fixture();
  const scanArgs = z
    .object(schemas.get("yaaif_skill_security_scan")!)
    .parse({ branch: "" });
  const reportArgs = z
    .object(schemas.get("yaaif_skill_security_report")!)
    .parse({ scan_id: "" });
  await handlers.get("yaaif_skill_security_scan")!(scanArgs);
  await handlers.get("yaaif_skill_security_report")!(reportArgs);
  assert.equal(calls[0][1], "/api/skills/security/scans?branch=");
  assert.equal(calls[1][1], "/api/skills/security");
});

test("bundled SkillSpector SOP works offline without auth or platform calls", async () => {
  const { handlers, calls } = fixture();
  const result = (await handlers.get("yaaif_skill_security")!({
    action: "guide",
  })) as Result;
  const guide = result.structuredContent!;
  assert.equal(guide.offline, true);
  assert.equal(guide.read_only, true);
  assert.deepEqual(Object.keys(guide.sections), [
    "overview",
    "triage",
    "repair",
    "troubleshooting",
    "sources",
  ]);
  assert.match(guide.sections.repair, /if_match/);
  assert.match(guide.sections.overview, /independent review/);
  assert.match(guide.sections.triage, /TP4/);
  assert.ok(
    guide.sources.every((source: { url: string }) =>
      source.url.startsWith("https://"),
    ),
  );
  assert.deepEqual(calls, []);
});

test("SOP topics provide focused guidance and remain in the existing OpenCode slot", async () => {
  const { handlers, schemas, calls } = fixture();
  const schema = z.object(schemas.get("yaaif_skill_security")!);
  assert.equal(
    schema.safeParse({ action: "guide", topic: "invalid" }).success,
    false,
  );
  for (const topic of [
    "overview",
    "triage",
    "repair",
    "troubleshooting",
    "sources",
  ]) {
    const input = schema.parse({ action: "guide", topic });
    const result = (await handlers.get("yaaif_skill_security")!(
      input,
    )) as Result;
    assert.deepEqual(Object.keys(result.structuredContent!.sections), [topic]);
  }
  assert.deepEqual(calls, []);
  assert.ok(OPENCODE_TOOL_ALLOWLIST_SET.has("yaaif_skill_security"));
  assert.ok(OPENCODE_TOOL_ALLOWLIST_SET.size <= 120);
});
