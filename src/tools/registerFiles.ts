import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Ctx } from "./ctx.js";
import { fail, ok } from "./helpers.js";
import { resolveDevSessionId } from "../lib/devSession.js";

/**
 * HTTP file/artifact helpers for ADK-style artifact names + versions.
 * Prefer local tools (yaaif_files_list / yaaif_load_artifacts / yaaif_file_load_context)
 * for skill authoring; use these when you need version history or REST parity.
 */
export function registerFileTools(server: McpServer, ctx: Ctx): void {
  server.registerTool("yaaif_file_artifact_versions", {
    description:
      "List every version of an ADK artifact name (session-scoped or user:-prefixed). Uses GET /api/files/artifacts/versions. Pass session_id (or call yaaif_dev_session_ensure first).",
    inputSchema: {
      artifact_name: z.string(),
      session_id: z.string().optional(),
    },
  }, async ({ artifact_name, session_id }) => {
    const name = artifact_name.trim();
    if (!name) return fail("artifact_name is required");
    const sessionId = await resolveDevSessionId(ctx, session_id);
    if (!sessionId) {
      return fail("session_id required — call yaaif_dev_session_ensure or pass session_id");
    }
    const params = new URLSearchParams({
      artifact_name: name,
      session_id: sessionId,
    });
    try {
      const result = await ctx.api.agentJSON("GET", `/api/files/artifacts/versions?${params}`);
      return ok(`Listed versions for ${name}.`, { result, session_id: sessionId });
    } catch (e) {
      return fail(String(e));
    }
  });

  server.registerTool("yaaif_file_artifact_delete", {
    description:
      "Delete one artifact version (?version=N) or every version (omit version) via DELETE /api/files/artifacts. Requires confirm=true.",
    inputSchema: {
      artifact_name: z.string(),
      session_id: z.string().optional(),
      version: z.number().optional(),
      confirm: z.boolean(),
    },
  }, async ({ artifact_name, session_id, version, confirm }) => {
    if (!confirm) return fail("Set confirm=true to delete artifact versions.");
    const name = artifact_name.trim();
    if (!name) return fail("artifact_name is required");
    const sessionId = await resolveDevSessionId(ctx, session_id);
    if (!sessionId) {
      return fail("session_id required — call yaaif_dev_session_ensure or pass session_id");
    }
    const params = new URLSearchParams({
      artifact_name: name,
      session_id: sessionId,
    });
    if (version !== undefined && version > 0) params.set("version", String(version));
    try {
      const result = await ctx.api.agentJSON("DELETE", `/api/files/artifacts?${params}`);
      return ok(`Deleted artifact ${name}${version && version > 0 ? ` v${version}` : " (all versions)"}.`, {
        result,
        session_id: sessionId,
      });
    } catch (e) {
      return fail(String(e));
    }
  });

  server.registerTool("yaaif_file_get_extracted", {
    description:
      "Fetch extracted text via GET /api/files/extracted. file_id may be a durable UUID or an ADK artifact filename; version selects a historical revision (omit/0 = latest).",
    inputSchema: {
      file_id: z.string(),
      session_id: z.string().optional(),
      version: z.number().optional(),
    },
  }, async ({ file_id, session_id, version }) => {
    const ref = file_id.trim();
    if (!ref) return fail("file_id is required");
    const sessionId = await resolveDevSessionId(ctx, session_id);
    if (!sessionId) {
      return fail("session_id required — call yaaif_dev_session_ensure or pass session_id");
    }
    const params = new URLSearchParams({
      file_id: ref,
      session_id: sessionId,
    });
    if (version !== undefined && version > 0) params.set("version", String(version));
    try {
      const result = await ctx.api.agentJSON("GET", `/api/files/extracted?${params}`);
      return ok(`Fetched extracted content for ${ref}.`, { result, session_id: sessionId });
    } catch (e) {
      return fail(String(e));
    }
  });

  server.registerTool("yaaif_session_files_list", {
    description:
      "List session files via GET /api/files (REST). Set latest_only=true to return one row per artifact_name (latest version). Prefer yaaif_files_list / yaaif_load_artifacts for skill authoring.",
    inputSchema: {
      session_id: z.string().optional(),
      latest_only: z.boolean().optional(),
      limit: z.number().optional(),
    },
  }, async ({ session_id, latest_only, limit }) => {
    const sessionId = await resolveDevSessionId(ctx, session_id);
    if (!sessionId) {
      return fail("session_id required — call yaaif_dev_session_ensure or pass session_id");
    }
    const params = new URLSearchParams({ session_id: sessionId });
    if (latest_only) params.set("latest_only", "true");
    if (limit && limit > 0) params.set("limit", String(limit));
    try {
      const result = await ctx.api.agentJSON("GET", `/api/files?${params}`);
      return ok("Listed session files.", { result, session_id: sessionId, latest_only: Boolean(latest_only) });
    } catch (e) {
      return fail(String(e));
    }
  });
}
