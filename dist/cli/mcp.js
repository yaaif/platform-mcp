import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { CLI_CLIENT } from "../config.js";
import { createMcpServer, createRuntime } from "../runtime.js";
import { PACKAGE_VERSION } from "../version.js";
export async function openCliMcp() {
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
export async function listTools(client) {
    const tools = [];
    let cursor;
    do {
        const page = await client.listTools(cursor ? { cursor } : {});
        tools.push(...page.tools);
        cursor = page.nextCursor;
    } while (cursor);
    return tools;
}
export async function callTool(client, name, args) {
    return await client.callTool({ name, arguments: args });
}
