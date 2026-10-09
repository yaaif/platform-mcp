import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Ctx } from "./ctx.js";
import { fail, ok } from "./helpers.js";
import {
  FILE_EVENT_PAYLOAD_FIELDS,
  FILE_EVENT_TYPES,
  buildFileWorkflows,
  type FileWorkflowOptions,
} from "../lib/fileWorkflow.js";

const stepSchema = z.object({
  tool_name: z.string().describe("Tool to call: a local tool (file_load_context, file_tables, …) or one of your MCP tools"),
  label: z.string().optional(),
  input: z.record(z.string()).optional().describe("tool argument -> binding path, e.g. {\"file_id\": \"signal.payload.file_id\"}"),
  output_key: z.string().optional().describe("where the result lands, e.g. context.my_result"),
  continue_on_error: z.boolean().optional(),
});

const optionsShape = {
  name: z.string().optional().describe("Base name; each workflow is '<name>: <event>'. Default 'File intake'."),
  description: z.string().optional(),
  events: z.array(z.enum(FILE_EVENT_TYPES)).optional().describe("Default ['file.ready','file.failed']"),
  agent_id: z.string().optional().describe("Scope the rule to one chat agent (matches origin.agent_id). Not with filter_contains."),
  filter_contains: z.string().optional().describe("Case-insensitive substring of the signal payload (agent id, MIME type, file-name fragment, channel)"),
  load_content: z.boolean().optional().describe("Add a step that loads the extracted text (file_load_context) into context.file_content"),
  load_tables: z.boolean().optional().describe("Add a step that loads the structured-table overview (file_tables) into context.file_tables"),
  steps: z.array(stepSchema).optional().describe("Custom processing steps after the loaders (file.ready workflow only)"),
  reply: z.boolean().optional().describe("Reply to where the file came from (chat/Teams/Lark/email). Default true."),
  message_binding: z.string().optional().describe("Reply text binding. Default signal.payload.summary; use a context.* path to send your step's result."),
  enabled: z.boolean().optional(),
};

function reference() {
  return {
    event_types: FILE_EVENT_TYPES,
    signal: { source: "file", entity_type: "file", entity_id: "<file_id>" },
    payload_fields: FILE_EVENT_PAYLOAD_FIELDS.map((field) => `signal.payload.${field}`),
    notes: [
      "Trigger rules for source 'file' match exactly; catch-all (any/*) rules never receive file events.",
      "The workflow runs as the uploader; reply_origin delivers to chat, Teams, Lark or email (sender only) and records deliver:<channel> on the file timeline.",
      "The built-in automatic chat summary is independent: turn it off per tenant if your workflow replies with its own message.",
      "Rules are per tenant: scope to one chat agent with agent_id / filter_contains.",
    ],
    docs: "agent-service/docs/file-workflows.md",
  };
}

/**
 * File workflows: ambient workflows triggered by file.ready / file.failed /
 * file.review_decided that read the extracted file, process it and reply to the
 * origin. The template tool is read-only; the create tool installs under an
 * existing ambient agent.
 */
export function registerFileWorkflowTools(server: McpServer, ctx: Ctx): void {
  server.registerTool("yaaif_file_workflow_template", {
    description:
      "Build (without installing) ambient workflow definitions that run when an uploaded file finishes extraction " +
      "(file.ready / file.failed / file.review_decided), optionally load the extracted text/tables, run your own tool " +
      "steps and reply to where the file came from. Returns workflow create bodies plus the event/payload reference. " +
      "Install them with yaaif_file_workflow_create or yaaif_ambient_workflow_create.",
    inputSchema: optionsShape,
  }, async (args) => {
    try {
      const workflows = buildFileWorkflows(args as FileWorkflowOptions);
      return ok(`Built ${workflows.length} file workflow(s). Nothing was installed.`, { workflows, ...reference() });
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e));
    }
  });

  server.registerTool("yaaif_file_workflow_create", {
    description:
      "Create file workflows (see yaaif_file_workflow_template) under an ambient agent: one workflow + trigger rule per event. " +
      "Use dry_run=true to preview the exact bodies. The workflows act as the uploader; the ambient agent only owns them.",
    inputSchema: {
      ambient_agent_id: z.string().describe("Ambient agent that owns the workflows (yaaif_ambient_agent_list / yaaif_ambient_agent_create)"),
      dry_run: z.boolean().optional(),
      ...optionsShape,
    },
  }, async (args) => {
    const { ambient_agent_id, dry_run, ...options } = args;
    const agentId = ambient_agent_id.trim();
    if (!agentId) return fail("ambient_agent_id is required");
    let workflows;
    try {
      workflows = buildFileWorkflows(options as FileWorkflowOptions);
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e));
    }
    if (dry_run) {
      return ok(`Dry run: ${workflows.length} workflow(s) would be created under ${agentId}.`, { dry_run: true, workflows, ...reference() });
    }
    const path = `/api/ambient/agents/${encodeURIComponent(agentId)}/workflows`;
    const created: unknown[] = [];
    const failed: Array<{ name: string; error: string }> = [];
    for (const body of workflows) {
      try {
        created.push(await ctx.api.agentJSON("POST", path, body));
      } catch (e) {
        failed.push({ name: body.name, error: String(e) });
      }
    }
    const summary = `Created ${created.length} of ${workflows.length} file workflow(s) under ${agentId}.`;
    if (created.length === 0) return fail(summary, { failed });
    return ok(failed.length > 0 ? `${summary} ${failed.length} failed.` : summary, { created, ...(failed.length ? { failed } : {}), ...reference() });
  });
}
