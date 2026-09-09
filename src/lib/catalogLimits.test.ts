import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CATALOG_LIST_LIMIT_MAX,
  MCP_TOOLS_PAGE_LIMIT,
  appendClampedLimit,
  clampCatalogLimit,
  listAllMcpToolNames,
  type McpToolsPage,
} from "./catalogLimits.js";

test("clampCatalogLimit caps at 200 and floors invalid values to fallback", () => {
  assert.equal(clampCatalogLimit(500, 50), CATALOG_LIST_LIMIT_MAX);
  assert.equal(clampCatalogLimit(1, 50), 1);
  assert.equal(clampCatalogLimit(200, 50), 200);
  assert.equal(clampCatalogLimit(undefined, 50), 50);
  assert.equal(clampCatalogLimit(0, 100), 100);
  assert.equal(clampCatalogLimit(-3, 20), 20);
});

test("appendClampedLimit writes at most 200 and skips empty values", () => {
  const params = new URLSearchParams();
  appendClampedLimit(params, undefined);
  assert.equal(params.has("limit"), false);
  appendClampedLimit(params, 0);
  assert.equal(params.has("limit"), false);
  appendClampedLimit(params, 500);
  assert.equal(params.get("limit"), "200");
});

test("listAllMcpToolNames pages at limit=200 and never requests more", async () => {
  const seen: string[] = [];
  const pages: Record<string, McpToolsPage> = {
    "/api/mcp-tools?limit=200&offset=0": {
      items: [{ name: "tool-a" }, { name: "tool-b" }],
      pagination: { has_more: true, next_offset: 200 },
    },
    "/api/mcp-tools?limit=200&offset=200": {
      items: [{ name: "tool-c" }],
      pagination: { has_more: false, next_offset: 201 },
    },
  };
  const names = await listAllMcpToolNames(async (path) => {
    seen.push(path);
    const page = pages[path];
    assert.ok(page, `unexpected path ${path}`);
    const limit = Number(new URLSearchParams(path.split("?")[1] ?? "").get("limit"));
    assert.ok(limit <= MCP_TOOLS_PAGE_LIMIT);
    assert.ok(limit <= CATALOG_LIST_LIMIT_MAX);
    return page;
  });
  assert.deepEqual(names, ["tool-a", "tool-b", "tool-c"]);
  assert.deepEqual(seen, [
    "/api/mcp-tools?limit=200&offset=0",
    "/api/mcp-tools?limit=200&offset=200",
  ]);
});
