import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { clientDescriptor, type BridgeClient } from "../config.js";

// This tests the built package, including actual MCP schema serialization. It
// uses fresh private state and never signs in or changes a real tenant.
for (const client of [
  "cursor",
  "codex",
  "claude",
  "vscode",
  "intellij",
  "opencode",
] as BridgeClient[]) {
  test(
    `built governance bridge starts for ${client}`,
    { skip: process.env.YAAIF_GOVERNANCE_SMOKE !== "1" },
    async () => {
      const state = await mkdtemp(join(tmpdir(), `governance-${client}-`));
      const env = Object.fromEntries(
        Object.entries(process.env).filter(
          (entry): entry is [string, string] => entry[1] !== undefined,
        ),
      );
      env[clientDescriptor(client).stateHomeEnv] = state;
      const transport = new StdioClientTransport({
        command: process.execPath,
        args: [
          fileURLToPath(new URL("../../dist/cli.js", import.meta.url)),
          "--client",
          client,
        ],
        env,
        stderr: "pipe",
      });
      const sdk = new Client({ name: "governance-smoke", version: "1.0.0" });
      try {
        await sdk.connect(transport);
        const list = await sdk.listTools();
        assert.deepEqual(
          list.tools
            .filter((tool) => tool.name.startsWith("yaaif_governance_"))
            .map((tool) => tool.name)
            .sort(),
          [
            "yaaif_governance_apply",
            "yaaif_governance_capabilities",
            "yaaif_governance_inspect",
            "yaaif_governance_preview",
            "yaaif_governance_proposal_get",
          ],
        );
        const access = await sdk.callTool({
          name: "yaaif_governance_capabilities",
          arguments: {},
        });
        assert.equal(access.isError, true);
        assert.match(
          JSON.stringify(access.content),
          /Authenticated user session required/,
        );
      } finally {
        await sdk.close();
        await rm(state, { recursive: true, force: true });
      }
    },
  );
}
