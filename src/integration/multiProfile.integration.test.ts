import assert from "node:assert/strict";
import test from "node:test";
import { createServer, type Server } from "node:http";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const entrypoint = fileURLToPath(new URL("../yaaif-cli.ts", import.meta.url));

async function run(args: string[], stateHome: string): Promise<{ code: number; stdout: string; stderr: string }> {
  return await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", entrypoint, ...args], {
      env: { ...process.env, YAAIF_CLI_HOME: stateHome },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

async function saveSession(home: string, profile: string, token: string, tenant: string, authority: string): Promise<void> {
  const directory = join(home, "profile-sessions", profile);
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "session.json"), JSON.stringify({
    profile_id: profile,
    oidc_authority: authority,
    tenant_id: tenant,
    tenant_name: tenant,
    tokens: { access_token: token, expiry: "2099-01-01T00:00:00Z" },
  }));
}

test("multi-profile CLI isolates sessions and copies a Scenario with destination identity", async () => {
  const home = await mkdtemp(join(tmpdir(), "yaaif-multiprofile-cli-"));
  const requests: Array<{ method: string; url: string; authorization: string; tenant: string; body: string }> = [];
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      requests.push({
        method: request.method ?? "",
        url: request.url ?? "",
        authorization: request.headers.authorization ?? "",
        tenant: String(request.headers["x-tenant-id"] ?? ""),
        body,
      });
      const send = (value: unknown) => {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify(value));
      };
      if (request.url === "/agent-service/api/agent-specs/source") return send({ current_revision: 1 });
      if (request.url === "/agent-service/api/agent-specs/source/revisions/1/export") return send({
        format: "yaaif.agent-spec.release/v1",
        manifest_hash: "abc123",
        snapshot: {
          id: "source-id",
          tenant_id: "prod-tenant",
          slug: "portable",
          name: "Portable Scenario",
          segments: [],
          requirements: [],
          slots: [],
        },
      });
      if (request.url?.startsWith("/agent-service/api/agent-specs?q=portable")) return send({ items: [] });
      if (request.url === "/agent-service/api/agent-specs" && request.method === "POST") return send({ id: "destination", slug: "portable" });
      if (request.url === "/agent-service/api/agent-specs/destination") return send({ id: "destination", status: "draft" });
      response.writeHead(404).end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("missing mock server address");
  const base = `http://127.0.0.1:${address.port}`;
  const authority = `${base}/auth/realms/yaaif`;
  try {
    for (const profile of ["prod", "stage"]) {
      const saved = await run(["profile", "save", profile, "--yaaif-url", base, "--json"], home);
      assert.equal(saved.code, 0, saved.stderr);
    }
    await saveSession(home, "prod", "prod-token", "prod-tenant", authority);
    await saveSession(home, "stage", "stage-token", "stage-tenant", authority);
    const cloned = await run(["profile", "clone", "prod", "clone", "--json"], home);
    assert.equal(cloned.code, 0, cloned.stderr);
    const profiles = JSON.parse((await run(["profile", "list", "--json"], home)).stdout);
    const prod = profiles.profiles.find((profile: { id: string }) => profile.id === "prod");
    const clone = profiles.profiles.find((profile: { id: string }) => profile.id === "clone");
    assert.equal(prod.session.authenticated, true);
    assert.equal(clone.session.authenticated, false);

    const previewResult = await run(["copy", "scenario", "source", "--from", "prod", "--to", "stage", "--json"], home);
    assert.equal(previewResult.code, 0, previewResult.stderr);
    const preview = JSON.parse(previewResult.stdout);
    assert.equal(preview.dry_run, true);
    assert.equal(requests.some((request) => request.method === "POST"), false);

    const copiedResult = await run(["copy", "scenario", "source", "--from", "prod", "--to", "stage", "--yes", "--json"], home);
    assert.equal(copiedResult.code, 0, copiedResult.stderr);
    const copied = JSON.parse(copiedResult.stdout);
    assert.equal(copied.created.id, "destination");
    const exportRequest = requests.find((request) => request.url?.includes("/export"));
    const createRequest = requests.find((request) => request.method === "POST");
    assert.equal(exportRequest?.authorization, "Bearer prod-token");
    assert.equal(exportRequest?.tenant, "prod-tenant");
    assert.equal(createRequest?.authorization, "Bearer stage-token");
    assert.equal(createRequest?.tenant, "stage-tenant");
    assert.doesNotMatch(createRequest?.body ?? "", /prod-token|prod-tenant|source-id/);
    const duplicate = await run(["profile", "clone", "prod", "clone", "--json"], home);
    assert.equal(duplicate.code, 1);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(home, { recursive: true, force: true });
  }
});

test("profile bundle CLI exports and imports configuration without sessions", async () => {
  const home = await mkdtemp(join(tmpdir(), "yaaif-profile-bundle-cli-"));
  const bundlePath = `${home}.bundle.json`;
  try {
    const saved = await run(["profile", "save", "prod", "--yaaif-url", "https://prod.example", "--json"], home);
    assert.equal(saved.code, 0, saved.stderr);
    const exported = await run(["profile", "export", "--out", bundlePath, "--json"], home);
    assert.equal(exported.code, 0, exported.stderr);
    const bundle = JSON.parse(await readFile(bundlePath, "utf8")) as { profiles: unknown[]; format: string };
    assert.equal(bundle.format, "yaaif.platform-profiles/v1");
    assert.doesNotMatch(JSON.stringify(bundle), /access_token|refresh_token|session\.json/);
    assert.equal((await run(["profile", "delete", "prod", "--json"], home)).code, 0);
    const previewResult = await run(["profile", "import", bundlePath, "--json"], home);
    assert.equal(previewResult.code, 0, previewResult.stderr);
    const preview = JSON.parse(previewResult.stdout);
    assert.equal(preview.dry_run, true);
    assert.equal(preview.import_count, 1);
    const appliedResult = await run(["profile", "import", bundlePath, "--activate", "prod", "--yes", "--json"], home);
    assert.equal(appliedResult.code, 0, appliedResult.stderr);
    const applied = JSON.parse(appliedResult.stdout);
    assert.equal(applied.imported, true);
    const profiles = JSON.parse((await run(["profile", "list", "--json"], home)).stdout);
    const active = profiles.profiles.find((profile: { id: string }) => profile.id === "prod");
    assert.equal(active.session.authenticated, false);
    assert.equal(profiles.active_profile_id, "prod");
    const duplicate = await run(["profile", "import", bundlePath, "--yes", "--json"], home);
    assert.equal(duplicate.code, 1);
    const protectedResult = await run(["profile", "export", "--out", join(home, "profiles.json"), "--json"], home);
    assert.equal(protectedResult.code, 2);
    assert.match(protectedResult.stderr, /refusing to overwrite live profile or session state/);
  } finally {
    await rm(home, { recursive: true, force: true });
    await rm(bundlePath, { force: true });
  }
});

test("skill copy CLI previews and writes only safe remapped files", async () => {
  const home = await mkdtemp(join(tmpdir(), "yaaif-skill-copy-cli-"));
  const writes: Array<{ method: string; url: string; body: string }> = [];
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      if (request.method === "PUT" || request.method === "POST") writes.push({ method: request.method, url: request.url ?? "", body });
      const send = (value: unknown) => {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify(value));
      };
      if (request.url === "/agent-service/api/skills?ids=demo&limit=1") return send({ items: [{ id: "demo", description: "Demo", instruction: "Use it", tools: ["tool_a"] }] });
      if (request.url === "/agent-service/api/skill-files/tree?path=demo") return send({ root: { kind: "directory", children: [
        { path: "demo/SKILL.md", kind: "file" },
        { path: "demo/references/guide.md", kind: "file" },
        { path: "demo/credentials.yaml", kind: "file" },
        { path: "demo/id_rsa.pem", kind: "file" },
      ] } });
      if (request.url?.includes("demo%2FSKILL.md")) return send({ content: "---\nname: demo\n---\nUse it" });
      if (request.url?.includes("guide.md")) return send({ content: "Guide" });
      if (request.url?.includes("credentials.yaml")) return send({ content: "password: secret" });
      if (request.url?.includes("id_rsa.pem")) return send({ content: "-----BEGIN PRIVATE KEY-----\nabc" });
      if (request.url === "/agent-service/api/skills?ids=copied&limit=1") return send({ items: [] });
      if (request.url === "/agent-service/api/skills" && request.method === "POST") return send({ id: "copied" });
      if (request.url === "/agent-service/api/skill-files/content" && request.method === "PUT") return send({ ok: true });
      response.writeHead(404).end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("missing mock server address");
  const base = `http://127.0.0.1:${address.port}`;
  const authority = `${base}/auth/realms/yaaif`;
  try {
    for (const profile of ["prod", "stage"]) {
      assert.equal((await run(["profile", "save", profile, "--yaaif-url", base, "--json"], home)).code, 0);
    }
    await saveSession(home, "prod", "prod-token", "prod-tenant", authority);
    await saveSession(home, "stage", "stage-token", "stage-tenant", authority);
    const previewResult = await run(["copy", "skill", "demo", "--from", "prod", "--to", "stage", "--new-id", "copied", "--json"], home);
    assert.equal(previewResult.code, 0, JSON.stringify(previewResult));
    const preview = JSON.parse(previewResult.stdout);
    assert.equal(preview.dry_run, true);
    assert.equal(preview.files.length, 2);
    assert.equal(preview.excluded.length, 2);
    assert.equal(writes.length, 0);
    const copiedResult = await run(["copy", "skill", "demo", "--from", "prod", "--to", "stage", "--new-id", "copied", "--yes", "--json"], home);
    assert.equal(copiedResult.code, 0, copiedResult.stderr);
    assert.equal(writes.filter((write) => write.method === "POST").length, 1);
    const fileWrites = writes.filter((write) => write.method === "PUT");
    assert.equal(fileWrites.length, 2);
    assert.ok(fileWrites.every((write) => write.body.includes("copied/")));
    assert.doesNotMatch(JSON.stringify(writes), /PRIVATE KEY|password: secret/);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(home, { recursive: true, force: true });
  }
});

test("ambient workflow copy CLI sanitizes graph and installs disabled", async () => {
  const home = await mkdtemp(join(tmpdir(), "yaaif-ambient-copy-cli-"));
  const writes: Array<{ method: string; url: string; body: string }> = [];
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      if (request.method === "POST") writes.push({ method: request.method, url: request.url ?? "", body });
      const send = (value: unknown) => {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify(value));
      };
      if (request.url === "/agent-service/api/ambient/workflows/wf-1") return send({
        id: "wf-1", ambient_agent_id: "aa-1", name: "Nightly sync", enabled: true,
        workflow_async_enabled: true, requires_approval: true,
        workflow_graph: { nodes: [
          { id: "safe", type: "tool_call", credential_id: "cred-1", approval_strategy_id: "approval-1", input: { url: "https://safe.example" } },
          { id: "secret", type: "action", token: "do-not-copy" },
        ] },
        policy: { allowed_child_workflow_ids: ["wf-child"], allowed_webhook_host_suffixes: [".example.com"] },
        trigger_rules: [{ event_type: "file.ready", agent_id: "chat-1" }],
      });
      if (request.url === "/agent-service/api/ambient/agents/aa-1") return send({ id: "aa-1", name: "Ambient" });
      if (request.url?.startsWith("/agent-service/api/ambient/agents?q=")) return send({ items: [{ id: "aa-stage", name: "Ambient" }] });
      if (request.url?.startsWith("/agent-service/api/ambient/workflows?ambient_agent_id=")) return send({ items: [] });
      if (request.url === "/agent-service/api/ambient/agents/aa-stage/workflows" && request.method === "POST") return send({ id: "wf-stage" });
      if (request.url === "/agent-service/api/ambient/workflows/wf-stage") return send({ id: "wf-stage", enabled: false });
      response.writeHead(404).end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("missing mock server address");
  const base = `http://127.0.0.1:${address.port}`;
  const authority = `${base}/auth/realms/yaaif`;
  try {
    for (const profile of ["prod", "stage"]) assert.equal((await run(["profile", "save", profile, "--yaaif-url", base, "--json"], home)).code, 0);
    await saveSession(home, "prod", "prod-token", "prod-tenant", authority);
    await saveSession(home, "stage", "stage-token", "stage-tenant", authority);
    const previewResult = await run(["copy", "workflow", "wf-1", "--from", "prod", "--to", "stage", "--json"], home);
    assert.equal(previewResult.code, 0, previewResult.stderr);
    const preview = JSON.parse(previewResult.stdout);
    assert.equal(preview.dry_run, true);
    assert.equal(preview.disabled_for_review, true);
    assert.equal(writes.length, 0);
    const copiedResult = await run(["copy", "workflow", "wf-1", "--from", "prod", "--to", "stage", "--yes", "--json"], home);
    assert.equal(copiedResult.code, 0, copiedResult.stderr);
    assert.equal(writes.length, 1);
    const body = JSON.parse(writes[0].body);
    assert.equal(body.enabled, false);
    assert.equal(body.workflow_async_enabled, false);
    assert.equal(body.requires_approval, false);
    assert.doesNotMatch(writes[0].body, /cred-1|approval-1|do-not-copy|wf-child|chat-1/);
    assert.match(writes[0].body, /example.com/);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(home, { recursive: true, force: true });
  }
});

test("MCP server copy CLI strips credential IDs and avoids refresh", async () => {
  const home = await mkdtemp(join(tmpdir(), "yaaif-mcp-copy-cli-"));
  const writes: Array<{ method: string; url: string; body: string }> = [];
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      if (request.method === "POST") writes.push({ method: request.method, url: request.url ?? "", body });
      const send = (value: unknown) => {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify(value));
      };
      if (request.url === "/agent-service/api/mcp-tools/servers/s1") return send({
        id: "s1", name: "ERP", endpoint: "https://erp.example/mcp", description: "ERP tools",
        transport_type: "STREAMABLE_HTTP", timeout_seconds: 45,
        header_mappings: [{ header_name: "X-Key", credential_id: "cred-1", credential_key: "token", value_prefix: "Bearer " }],
      });
      if (request.url === "/agent-service/api/mcp-tools/servers/s1/credential-profiles") return send({ items: [{ profile_name: "production" }] });
      if (request.url?.startsWith("/agent-service/api/mcp-tools/servers?q=")) return send({ items: [] });
      if (request.url === "/agent-service/api/mcp-tools/servers" && request.method === "POST") return send({ id: "s2" });
      if (request.url === "/agent-service/api/mcp-tools/servers/s2") return send({ id: "s2" });
      response.writeHead(404).end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("missing mock server address");
  const base = `http://127.0.0.1:${address.port}`;
  const authority = `${base}/auth/realms/yaaif`;
  try {
    for (const profile of ["prod", "stage"]) assert.equal((await run(["profile", "save", profile, "--yaaif-url", base, "--json"], home)).code, 0);
    await saveSession(home, "prod", "prod-token", "prod-tenant", authority);
    await saveSession(home, "stage", "stage-token", "stage-tenant", authority);
    const previewResult = await run(["copy", "mcp-server", "s1", "--from", "prod", "--to", "stage", "--json"], home);
    assert.equal(previewResult.code, 0, previewResult.stderr);
    const preview = JSON.parse(previewResult.stdout);
    assert.equal(preview.dry_run, true);
    assert.equal(preview.refresh_tools, false);
    assert.deepEqual(preview.credential_profiles_required, ["production"]);
    assert.equal(writes.length, 0);
    const copiedResult = await run(["copy", "mcp-server", "s1", "--from", "prod", "--to", "stage", "--yes", "--json"], home);
    assert.equal(copiedResult.code, 0, copiedResult.stderr);
    assert.equal(writes.length, 1);
    assert.doesNotMatch(writes[0].body, /cred-1/);
    assert.match(writes[0].body, /Bearer/);
    assert.doesNotMatch(writes[0].body, /refresh/);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(home, { recursive: true, force: true });
  }
});

test("agent copy CLI creates a disabled definition without mappings", async () => {
  const home = await mkdtemp(join(tmpdir(), "yaaif-agent-copy-cli-"));
  const writes: Array<{ method: string; url: string; body: string }> = [];
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      if (request.method === "POST") writes.push({ method: request.method, url: request.url ?? "", body });
      const send = (value: unknown) => {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify(value));
      };
      if (request.url === "/agent-service/api/agents/a1") return send({ id: "a1", name: "Support", description: "Support agent", goal_prompt: "Help users", agent_type: "workflow", skill_ids: ["skill-1"], enabled: true });
      if (request.url?.startsWith("/agent-service/api/agents?q=")) return send({ items: [] });
      if (request.url === "/agent-service/api/agents" && request.method === "POST") return send({ id: "a2" });
      if (request.url === "/agent-service/api/agents/a2") return send({ id: "a2", enabled: false });
      response.writeHead(404).end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("missing mock server address");
  const base = `http://127.0.0.1:${address.port}`;
  const authority = `${base}/auth/realms/yaaif`;
  try {
    for (const profile of ["prod", "stage"]) assert.equal((await run(["profile", "save", profile, "--yaaif-url", base, "--json"], home)).code, 0);
    await saveSession(home, "prod", "prod-token", "prod-tenant", authority);
    await saveSession(home, "stage", "stage-token", "stage-tenant", authority);
    const previewResult = await run(["copy", "agent", "a1", "--from", "prod", "--to", "stage", "--json"], home);
    assert.equal(previewResult.code, 0, previewResult.stderr);
    const preview = JSON.parse(previewResult.stdout);
    assert.equal(preview.dry_run, true);
    assert.deepEqual(preview.required_skill_ids, ["skill-1"]);
    assert.equal(preview.enabled_for_review, false);
    assert.equal(writes.length, 0);
    const copiedResult = await run(["copy", "agent", "a1", "--from", "prod", "--to", "stage", "--yes", "--json"], home);
    assert.equal(copiedResult.code, 0, copiedResult.stderr);
    assert.equal(writes.length, 1);
    const body = JSON.parse(writes[0].body);
    assert.equal(body.enabled, false);
    assert.equal(body.agent_type, "workflow");
    assert.deepEqual(body.skill_ids, []);
    assert.doesNotMatch(writes[0].body, /spec_id|slot_key/);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(home, { recursive: true, force: true });
  }
});
