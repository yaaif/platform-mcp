import assert from "node:assert/strict";
import test from "node:test";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Ctx } from "./ctx.js";
import { excerptAround, rankDocPages, registerDocsTools } from "./registerDocs.js";

test("rankDocPages prefers a title hit and clips the excerpt", () => {
  const long = `${"intro ".repeat(80)}ambient workflow runs stay on the worker. ${"tail ".repeat(80)}`;
  const hits = rankDocPages(
    [
      { slug: "agents", title: "Agents", markdown: "An ambient workflow is mentioned once." },
      { slug: "workflows", title: "Ambient workflows", markdown: long },
    ],
    "ambient workflow",
  );
  assert.equal(hits[0]?.slug, "workflows");
  assert.ok((hits[0]?.score ?? 0) > (hits[1]?.score ?? 0));
  assert.ok((hits[0]?.excerpt.length ?? 0) < long.length);
  assert.match(hits[0]?.excerpt ?? "", /ambient workflow/);
  assert.match(hits[0]?.excerpt ?? "", /^…/);
});

test("rankDocPages omits pages with no hit", () => {
  const hits = rankDocPages(
    [{ slug: "getting-started", title: "Getting started", markdown: "Install the desktop app." }],
    "sap odata",
  );
  assert.deepEqual(hits, []);
});

test("excerptAround keeps a short page intact", () => {
  assert.equal(excerptAround("Sign in, then open Documentation.", "sign"), "Sign in, then open Documentation.");
});

type RegisteredTool = {
  handler: (args: Record<string, unknown>) => Promise<{
    isError?: boolean;
    structuredContent?: Record<string, unknown>;
  }>;
};

function registerTools(docsJSON: Ctx["api"]["docsJSON"]): Map<string, RegisteredTool> {
  const tools = new Map<string, RegisteredTool>();
  const server = {
    registerTool(name: string, _definition: unknown, handler: RegisteredTool["handler"]) {
      tools.set(name, { handler });
    },
  } as unknown as McpServer;
  registerDocsTools(server, { api: { docsJSON } } as Ctx);
  return tools;
}

test("yaaif_docs_search lists the current version without fetching pages", async () => {
  const calls: string[] = [];
  const tools = registerTools(async (_method, path) => {
    calls.push(path);
    return {
      version: "1.4.0",
      platform_version: "1.4.6",
      pages: [{ slug: "getting-started", title: "Getting started" }],
    };
  });
  const result = await tools.get("yaaif_docs_search")!.handler({});
  assert.equal(result.isError, undefined);
  assert.deepEqual(result.structuredContent, {
    version: "1.4.0",
    platform_version: "1.4.6",
    pages: [{ slug: "getting-started", title: "Getting started" }],
  });
  assert.deepEqual(calls, ["/api/manifest"]);
});

test("yaaif_docs_page returns markdown for the requested slug", async () => {
  const tools = registerTools(async (_method, path) => {
    assert.equal(path, "/api/page?page=getting-started");
    return {
      version: "1.4.0",
      slug: "getting-started",
      title: "Getting started",
      markdown: "# Getting started\n\nOpen the admin UI.",
    };
  });
  const result = await tools.get("yaaif_docs_page")!.handler({ page: "getting-started" });
  assert.equal(result.structuredContent?.version, "1.4.0");
  assert.match(String(result.structuredContent?.markdown), /admin UI/);
  assert.equal(result.structuredContent?.truncated, false);
});
