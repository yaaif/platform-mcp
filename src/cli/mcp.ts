import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";
import { CLI_CLIENT } from "../config.js";
import { createMcpServer, createRuntime, type Runtime } from "../runtime.js";
import { PACKAGE_VERSION } from "../version.js";

export type CliMcp = {
  runtime: Runtime;
  client: Client;
  close: () => Promise<void>;
};

export async function openCliMcp(): Promise<CliMcp> {
  const runtime = await createRuntime(CLI_CLIENT);
  const server = createMcpServer(runtime);
  const client = new Client({ name: "yaaif-cli", version: PACKAGE_VERSION });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return {
    runtime,
    client,
    close: async () => {
      await Promise.allSettled([client.close(), server.close()]);
    },
  };
}

export async function listTools(client: Client): Promise<Tool[]> {
  const tools: Tool[] = [];
  let cursor: string | undefined;
  do {
    const page = await client.listTools(cursor ? { cursor } : {});
    tools.push(...page.tools);
    cursor = page.nextCursor;
  } while (cursor);
  return tools;
}

export async function callTool(
  client: Client,
  name: string,
  args: Record<string, unknown>,
): Promise<CallToolResult> {
  return await client.callTool({ name, arguments: args }) as CallToolResult;
}
