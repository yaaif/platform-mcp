import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { callTool, listTools, openCliMcp } from "./mcp.js";

test("CLI uses isolated state and exposes the full MCP contract", async () => {
  const state = await mkdtemp(join(tmpdir(), "yaaif-cli-state-"));
  const previous = process.env.YAAIF_CLI_HOME;
  process.env.YAAIF_CLI_HOME = state;
  const mcp = await openCliMcp();
  try {
    assert.equal(mcp.runtime.cfg.client.id, "cli");
    assert.equal(mcp.runtime.cfg.client.oidcClientId, "yaaif-cli");
    assert.equal(mcp.runtime.cfg.stateHome, state);
    const tools = await listTools(mcp.client);
    assert.ok(tools.some((tool) => tool.name === "yaaif_credential_create"));
    assert.ok(tools.some((tool) => tool.name === "yaaif_agent_spec_sync_preview"));
    const whoami = await callTool(mcp.client, "yaaif_whoami", {});
    assert.equal(whoami.isError, undefined);
    assert.equal((whoami.structuredContent as { authenticated?: boolean }).authenticated, false);
    assert.doesNotMatch(JSON.stringify(whoami), /access_token|refresh_token/);
  } finally {
    await mcp.close();
    if (previous === undefined) delete process.env.YAAIF_CLI_HOME;
    else process.env.YAAIF_CLI_HOME = previous;
    await rm(state, { recursive: true, force: true });
  }
});
