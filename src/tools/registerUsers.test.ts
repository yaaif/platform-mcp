import assert from "node:assert/strict";
import test from "node:test";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Ctx } from "./ctx.js";
import { registerUserTools } from "./registerUsers.js";

type RegisteredTool = {
  handler: (args: Record<string, unknown>) => Promise<{ isError?: boolean; content?: Array<{ text?: string }>; structuredContent?: Record<string, unknown> }>;
};

test("yaaif_user_create posts to /api/users", async () => {
  const tools = new Map<string, RegisteredTool>();
  const server = {
    registerTool(name: string, _definition: unknown, handler: RegisteredTool["handler"]) {
      tools.set(name, { handler });
    },
  } as unknown as McpServer;
  const ctx = {
    api: {
      apiJSON: async (method: string, path: string, body?: unknown) => {
        if (method === "POST" && path === "/api/users") {
          assert.deepEqual(body, {
            name: "Ada Lovelace",
            email: "ada@example.com",
            role: "VIEWER",
            active: true,
          });
          return {
            id: "u1",
            name: "Ada Lovelace",
            email: "ada@example.com",
            role: "VIEWER",
            active: true,
            temporary_password: "TempPass!234",
            password_must_reset: true,
            identity_provider: "keycloak",
          };
        }
        throw new Error(`unexpected ${method} ${path}`);
      },
    },
  } as unknown as Ctx;
  registerUserTools(server, ctx);

  const create = tools.get("yaaif_user_create");
  assert.ok(create);
  const result = await create.handler({ name: "Ada Lovelace", email: "ada@example.com" });
  assert.equal(result.isError, undefined);
  assert.equal(result.structuredContent?.user?.email, "ada@example.com");
  assert.equal(result.structuredContent?.temporary_password, "TempPass!234");
});

test("yaaif_user_role_set requires confirm_admin_grant for ADMIN", async () => {
  const tools = new Map<string, RegisteredTool>();
  const server = {
    registerTool(name: string, _definition: unknown, handler: RegisteredTool["handler"]) {
      tools.set(name, { handler });
    },
  } as unknown as McpServer;
  const calls: string[] = [];
  const ctx = {
    api: {
      apiJSON: async (method: string, path: string) => {
        calls.push(`${method} ${path}`);
        throw new Error(`unexpected ${method} ${path}`);
      },
    },
  } as unknown as Ctx;
  registerUserTools(server, ctx);

  const roleSet = tools.get("yaaif_user_role_set");
  assert.ok(roleSet);
  const result = await roleSet.handler({ email: "ada@example.com", role: "ADMIN" });
  assert.equal(result.isError, true);
  assert.match(String(result.content?.[0]?.text ?? ""), /confirm_admin_grant/);
  assert.deepEqual(calls, []);
});

test("yaaif_user_role_set updates via PUT /api/users/:id", async () => {
  const tools = new Map<string, RegisteredTool>();
  const server = {
    registerTool(name: string, _definition: unknown, handler: RegisteredTool["handler"]) {
      tools.set(name, { handler });
    },
  } as unknown as McpServer;
  const ctx = {
    api: {
      apiJSON: async (method: string, path: string, body?: unknown) => {
        if (method === "GET" && path.startsWith("/api/users?")) {
          return { items: [{ id: "u1", email: "ada@example.com", role: "VIEWER", name: "Ada", active: true }] };
        }
        if (method === "GET" && path === "/api/users/u1") {
          return { id: "u1", email: "ada@example.com", role: "VIEWER", name: "Ada", active: true };
        }
        if (method === "PUT" && path === "/api/users/u1") {
          assert.deepEqual(body, { role: "EDITOR" });
          return { id: "u1", email: "ada@example.com", role: "EDITOR", name: "Ada", active: true };
        }
        throw new Error(`unexpected ${method} ${path}`);
      },
    },
  } as unknown as Ctx;
  registerUserTools(server, ctx);

  const roleSet = tools.get("yaaif_user_role_set");
  assert.ok(roleSet);
  const result = await roleSet.handler({ email: "ada@example.com", role: "editor" });
  assert.equal(result.isError, undefined);
  assert.equal(result.structuredContent?.previous_role, "VIEWER");
});
