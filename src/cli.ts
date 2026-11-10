#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { parseBridgeClient } from "./config.js";
import { runInstallerSetup } from "./lib/installerSetup.js";
import { parseInstallAction, runInstall } from "./lib/pluginInstall.js";
import { parseSetupAction } from "./lib/installerSetup.js";
import { createMcpServer, createRuntime } from "./runtime.js";

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (parseInstallAction(argv)) {
    const code = await runInstall({ argv });
    process.exit(code);
  }
  const setup = parseSetupAction(argv);
  if (setup) {
    const code = await runInstallerSetup(setup, { argv });
    process.exit(code);
  }

  const runtime = await createRuntime(parseBridgeClient());
  const server = createMcpServer(runtime);

  // A floating device-login poll must not terminate the stdio server. Node treats
  // an unhandled rejection as fatal, and OpenCode then drops every YAAIF tool.
  process.on("unhandledRejection", (err) => {
    console.error("unhandled rejection", err);
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
