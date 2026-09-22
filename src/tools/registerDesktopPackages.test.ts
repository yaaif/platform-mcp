import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Ctx } from "./ctx.js";
import { registerDesktopPackageTools } from "./registerDesktopPackages.js";

type ToolResult = {
  isError?: boolean;
  content?: Array<{ text?: string }>;
  structuredContent?: Record<string, unknown>;
};

type RegisteredTool = {
  handler: (args: Record<string, unknown>) => Promise<ToolResult>;
};

function register(api: Ctx["api"]): Map<string, RegisteredTool> {
  const tools = new Map<string, RegisteredTool>();
  const server = {
    registerTool(name: string, _definition: unknown, handler: RegisteredTool["handler"]) {
      tools.set(name, { handler });
    },
  } as unknown as McpServer;
  registerDesktopPackageTools(server, { api } as Ctx);
  return tools;
}

test("inspect reports python command MCP without calling the API", async () => {
  const dir = mkdtempSync(join(tmpdir(), "yaaif-pkg-inspect-"));
  writeFileSync(join(dir, "pyproject.toml"), 'name = "demo-mcp-service"\nversion = "1.2.3"\n');
  mkdirSync(join(dir, "src", "demo_mcp_service"), { recursive: true });
  writeFileSync(join(dir, "src", "demo_mcp_service", "main.py"), "print('ok')\n");

  const tools = register({
    apiJSON: async () => {
      throw new Error("api should not be called");
    },
  } as unknown as Ctx["api"]);

  const result = await tools.get("yaaif_desktop_tool_package_inspect")!.handler({ source_dir: dir, platform: "linux" });
  assert.equal(result.isError, undefined);
  const inspected = result.structuredContent?.inspected as { launch?: { tool_key?: string; version?: string } };
  assert.equal(inspected.launch?.tool_key, "demo.mcp");
  assert.equal(inspected.launch?.version, "1.2.3");
});

test("publish mode=add creates package then uploads artifact", async () => {
  const dir = mkdtempSync(join(tmpdir(), "yaaif-pkg-pub-"));
  writeFileSync(join(dir, "stdio-server.js"), "#!/usr/bin/env node\n");
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "dummy-mcp-service", version: "1.0.0" }));

  const calls: Array<{ method: string; path: string; body?: unknown; form?: boolean }> = [];
  const tools = register({
    apiJSON: async (method: string, path: string, body?: unknown) => {
      calls.push({ method, path, body });
      if (method === "GET" && path.startsWith("/api/desktop/tool-packages?")) {
        return { items: [] };
      }
      if (method === "POST" && path === "/api/desktop/tool-packages") {
        return { id: "pkg-1", tool_key: "dummy.mcp", version: "1.0.0", ...(body as object) };
      }
      if (method === "GET" && path === "/api/desktop/tool-packages/pkg-1") {
        return { id: "pkg-1", tool_key: "dummy.mcp", version: "1.0.0", artifacts: [{ platform: "linux" }] };
      }
      throw new Error(`unexpected ${method} ${path}`);
    },
    apiForm: async (method: string, path: string, fields: Record<string, string>, file: { filename: string; body: Buffer }) => {
      calls.push({ method, path, body: fields, form: true });
      assert.equal(method, "POST");
      assert.equal(path, "/api/desktop/tool-packages/pkg-1/artifacts");
      assert.equal(fields.platform, "linux");
      assert.equal(fields.entrypoint, "stdio-server.js");
      assert.ok(file.body.length > 0);
      return { platform: "linux", entrypoint: fields.entrypoint, sha256: "abc" };
    },
  } as unknown as Ctx["api"]);

  const result = await tools.get("yaaif_desktop_tool_package_publish")!.handler({
    source_dir: dir,
    mode: "add",
    platform: "linux",
  });
  assert.equal(result.isError, undefined, result.content?.[0]?.text);
  assert.equal(result.structuredContent?.action, "created");
  assert.equal(calls.some((c) => c.form), true);
});

test("delete resolves tool_key then DELETEs by id", async () => {
  const tools = register({
    apiJSON: async (method: string, path: string) => {
      if (method === "GET" && path.includes("?q=")) {
        return { items: [{ id: "pkg-9", tool_key: "sap-gui.mcp" }] };
      }
      if (method === "GET" && path === "/api/desktop/tool-packages/pkg-9") {
        return { id: "pkg-9", tool_key: "sap-gui.mcp" };
      }
      if (method === "DELETE" && path === "/api/desktop/tool-packages/pkg-9") {
        return undefined;
      }
      throw new Error(`unexpected ${method} ${path}`);
    },
  } as unknown as Ctx["api"]);

  const result = await tools.get("yaaif_desktop_tool_package_delete")!.handler({ package_id: "sap-gui.mcp" });
  assert.equal(result.isError, undefined, result.content?.[0]?.text);
  assert.equal(result.structuredContent?.deleted, true);
  assert.equal(result.structuredContent?.package_id, "pkg-9");
});

test("publish mode=add fails when tool_key already exists", async () => {
  const dir = mkdtempSync(join(tmpdir(), "yaaif-pkg-dup-"));
  writeFileSync(join(dir, "stdio-server.js"), "ok\n");
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "dummy-mcp-service", version: "1.0.0" }));

  const tools = register({
    apiJSON: async (method: string, path: string) => {
      if (method === "GET" && path.startsWith("/api/desktop/tool-packages?")) {
        return { items: [{ id: "pkg-1", tool_key: "dummy.mcp" }] };
      }
      if (method === "GET" && path === "/api/desktop/tool-packages/pkg-1") {
        return { id: "pkg-1", tool_key: "dummy.mcp" };
      }
      throw new Error(`unexpected ${method} ${path}`);
    },
  } as unknown as Ctx["api"]);

  const result = await tools.get("yaaif_desktop_tool_package_publish")!.handler({
    source_dir: dir,
    mode: "add",
    platform: "linux",
  });
  assert.equal(result.isError, true);
  assert.match(String(result.content?.[0]?.text ?? ""), /already exists/);
});

test("install queues control-plane install for each worker", async () => {
  const posted: Array<{ path: string; body: unknown }> = [];
  const tools = register({
    apiJSON: async (method: string, path: string) => {
      if (method === "GET" && path.includes("?q=")) return { items: [{ id: "pkg-1", tool_key: "sap-gui.mcp" }] };
      if (method === "GET" && path === "/api/desktop/tool-packages/pkg-1") {
        return { id: "pkg-1", tool_key: "sap-gui.mcp", version: "1.0.0" };
      }
      throw new Error(`unexpected ${method} ${path}`);
    },
    controlPlaneJSON: async (method: string, path: string, body?: unknown) => {
      posted.push({ path, body });
      assert.equal(method, "POST");
      return { run_id: "run-1", status: "queued", worker_id: (body as { worker_id: string }).worker_id };
    },
  } as unknown as Ctx["api"]);

  const result = await tools.get("yaaif_desktop_tool_package_upgrade")!.handler({
    package_id: "sap-gui.mcp",
    worker_ids: ["w-a", "w-b"],
    platform: "windows",
  });
  assert.equal(result.isError, undefined, result.content?.[0]?.text);
  assert.equal(result.structuredContent?.action, "upgrade");
  assert.equal(posted.length, 2);
  assert.equal(posted[0]?.path, "/api/desktop/tool-packages/pkg-1/install");
  assert.deepEqual(posted[0]?.body, { worker_id: "w-a", platform: "windows" });
});

test("uninstall posts tool_key to control-plane remove", async () => {
  const posted: Array<{ path: string; body: unknown }> = [];
  const tools = register({
    apiJSON: async (method: string, path: string) => {
      if (method === "GET" && path === "/api/desktop/tool-packages/11111111-1111-1111-1111-111111111111") {
        return { id: "11111111-1111-1111-1111-111111111111", tool_key: "sap-gui.mcp", version: "1.0.0" };
      }
      throw new Error(`unexpected ${method} ${path}`);
    },
    controlPlaneJSON: async (method: string, path: string, body?: unknown) => {
      posted.push({ path, body });
      return { run_id: "run-rm", status: "queued" };
    },
  } as unknown as Ctx["api"]);

  const result = await tools.get("yaaif_desktop_tool_package_uninstall")!.handler({
    package_id: "11111111-1111-1111-1111-111111111111",
    worker_id: "w-1",
  });
  assert.equal(result.isError, undefined, result.content?.[0]?.text);
  assert.equal(posted[0]?.path, "/api/desktop/tool-packages/11111111-1111-1111-1111-111111111111/remove");
  assert.deepEqual(posted[0]?.body, { worker_id: "w-1", tool_key: "sap-gui.mcp" });
});

test("worker_status summarizes install vs upgrade", async () => {
  const tools = register({
    apiJSON: async (method: string, path: string) => {
      if (method === "GET" && path === "/api/desktop/tool-packages/11111111-1111-1111-1111-111111111111") {
        return { id: "11111111-1111-1111-1111-111111111111", tool_key: "sap-gui.mcp", version: "1.1.0" };
      }
      throw new Error(`unexpected ${method} ${path}`);
    },
    controlPlaneJSON: async (method: string, path: string) => {
      if (path.startsWith("/api/desktop/workers")) {
        return { items: [{ id: "w-1", platform: "windows", display_name: "Plant PC" }] };
      }
      if (path.includes("dispatch_type=tool_install")) {
        return {
          items: [{
            id: "run-1",
            worker_id: "w-1",
            status: "completed",
            created_at: "2026-01-01T00:00:00Z",
            payload: {
              dispatch_type: "tool_install",
              package_id: "11111111-1111-1111-1111-111111111111",
              tool_key: "sap-gui.mcp",
              version: "1.0.0",
            },
          }],
        };
      }
      if (path.includes("dispatch_type=tool_remove")) return { items: [] };
      throw new Error(`unexpected ${method} ${path}`);
    },
  } as unknown as Ctx["api"]);

  const result = await tools.get("yaaif_desktop_tool_package_worker_status")!.handler({
    package_id: "11111111-1111-1111-1111-111111111111",
    worker_id: "w-1",
  });
  assert.equal(result.isError, undefined, result.content?.[0]?.text);
  const workers = result.structuredContent?.workers as Array<{ recommended_action?: string; update_available?: boolean }>;
  assert.equal(workers[0]?.recommended_action, "upgrade");
  assert.equal(workers[0]?.update_available, true);
});
