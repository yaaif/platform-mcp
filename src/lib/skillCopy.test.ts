import assert from "node:assert/strict";
import test from "node:test";
import type { Runtime } from "../runtime.js";
import { copySkill } from "./skillCopy.js";

function runtime(profile: string, calls: Array<{ method: string; path: string; body?: unknown }>, conflict = false): Runtime {
  return {
    cfg: { activeProfileId: profile, client: { updatedBy: `test-${profile}` } },
    api: {
      agentJSON: async (method: string, path: string, body?: unknown) => {
        calls.push({ method, path, body });
        if (path === "/api/skills?ids=demo&limit=1") return { items: [{ id: "demo", description: "Demo", instruction: "Use it", tools: ["tool_a"] }] };
        if (path === "/api/skill-files/tree?path=demo") return { root: { kind: "directory", children: [
          { path: "demo/SKILL.md", kind: "file" },
          { path: "demo/references/guide.md", kind: "file" },
          { path: "demo/credentials.yaml", kind: "file" },
          { path: "demo/id_rsa.pem", kind: "file" },
        ] } };
        if (path.includes("SKILL.md")) return { content: "---\nname: demo\n---\nUse it" };
        if (path.includes("guide.md")) return { content: "Guide" };
        if (path.includes("credentials.yaml")) return { content: "password: secret" };
        if (path.includes("id_rsa.pem")) return { content: "-----BEGIN PRIVATE KEY-----\nabc" };
        if (path === "/api/skills?ids=copied&limit=1") return { items: conflict ? [{ id: "copied" }] : [] };
        if (path === "/api/skills" && method === "POST") return { id: "copied" };
        if (path === "/api/skill-files/content" && method === "PUT") return { path: (body as { path?: string })?.path };
        throw new Error(`unexpected ${method} ${path}`);
      },
    },
  } as unknown as Runtime;
}

test("skill copy previews and writes safe files with a remapped id", async () => {
  const calls: Array<{ method: string; path: string; body?: unknown }> = [];
  const source = runtime("prod", calls);
  const destination = runtime("stage", calls);
  const preview = await copySkill({ source, destination, skillId: "demo", newSkillId: "copied", dryRun: true });
  assert.equal(preview.conflict, false);
  assert.equal(preview.files.length, 2);
  assert.equal(preview.excluded.length, 2);
  assert.equal(calls.some((call) => call.method === "POST"), false);
  const copied = await copySkill({ source, destination, skillId: "demo", newSkillId: "copied", dryRun: false, confirm: true });
  assert.equal(copied.created.id, "copied");
  const writes = calls.filter((call) => call.method === "PUT");
  assert.equal(writes.length, 2);
  assert.ok(writes.every((call) => String((call.body as { path: string }).path).startsWith("copied/")));
  assert.match(String((writes[0].body as { content: string }).content), /name: copied/);
  assert.doesNotMatch(JSON.stringify(writes), /PRIVATE KEY|password: secret/);
});

test("skill copy refuses destination conflicts", async () => {
  const calls: Array<{ method: string; path: string; body?: unknown }> = [];
  await assert.rejects(() => copySkill({
    source: runtime("prod", calls),
    destination: runtime("stage", calls, true),
    skillId: "demo",
    newSkillId: "copied",
    dryRun: false,
    confirm: true,
  }), /already exists/);
  assert.equal(calls.some((call) => call.method === "POST"), false);
});
