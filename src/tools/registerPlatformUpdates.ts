import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { fail, ok } from "./helpers.js";
import type { Ctx } from "./ctx.js";

export function registerPlatformUpdateTools(server: McpServer, ctx: Ctx): void {
  server.registerTool("yaaif_platform_update_status", {
    description: "Read installed platform version, update driver, last registry check and active release job. Requires installation.read; never starts an update.",
    inputSchema: {},
  }, async () => {
    try {
      return ok("Fetched platform update status.", { status: await ctx.api.apiJSON("GET", "/api/platform-updates/status") });
    } catch (e) { return fail(String(e)); }
  });

  server.registerTool("yaaif_platform_update_jobs_list", {
    description: "List approval-gated platform release jobs, newest first. Read-only; checks, cancellations and upgrades are not performed.",
    inputSchema: { limit: z.number().int().min(1).max(100).optional() },
  }, async ({ limit }) => {
    try {
      return ok("Listed platform update jobs.", { result: await ctx.api.apiJSON("GET", `/api/platform-updates/jobs?limit=${limit ?? 20}`) });
    } catch (e) { return fail(String(e)); }
  });

  server.registerTool("yaaif_platform_update_job_get", {
    description: "Read one platform release job, including component versions, approval id and errors. Does not cancel it.",
    inputSchema: { job_id: z.string() },
  }, async ({ job_id }) => {
    try {
      return ok(`Fetched platform update job ${job_id}.`, { job: await ctx.api.apiJSON("GET", `/api/platform-updates/jobs/${encodeURIComponent(job_id)}`) });
    } catch (e) { return fail(String(e)); }
  });
}
