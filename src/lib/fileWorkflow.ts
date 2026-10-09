/**
 * Builders for "file workflows": ambient workflows triggered by the platform's
 * file events (source "file": file.ready / file.failed / file.review_decided) that
 * read the extracted file, do custom processing and reply to where the file came from.
 *
 * Pure functions (no I/O) so every IDE, OpenCode and the tests share one definition.
 * Reference: agent-service/docs/file-workflows.md.
 */

export const FILE_EVENT_SOURCE = "file";

export const FILE_EVENT_TYPES = ["file.ready", "file.failed", "file.review_decided"] as const;
export type FileEventType = (typeof FILE_EVENT_TYPES)[number];

/** Payload fields a trigger / binding can use (signal.payload.*). */
export const FILE_EVENT_PAYLOAD_FIELDS = [
  "file_id",
  "name",
  "mime_type",
  "status",
  "run_id",
  "data_class",
  "quality_score",
  "extracted_chars",
  "review_status",
  "summary",
  "error",
  "origin.channel",
  "origin.session_id",
  "origin.user_id",
  "origin.agent_id",
  "origin.source",
  "session_id",
  "chat_session_id",
] as const;

export type ProcessStep = {
  /** Local or MCP tool the step calls, e.g. "file_load_context", "file_tables" or your own tool. */
  tool_name: string;
  label?: string;
  /** Map of tool argument -> binding path (e.g. {"file_id": "signal.payload.file_id"}). */
  input?: Record<string, string>;
  /** Where the result lands; default context.<tool_name>_result. */
  output_key?: string;
  continue_on_error?: boolean;
};

export type FileWorkflowOptions = {
  name?: string;
  description?: string;
  /** Events to handle; default ["file.ready", "file.failed"]. */
  events?: FileEventType[];
  /** Case-insensitive substring matched against the whole signal payload JSON. */
  filter_contains?: string;
  /** Shortcut: scope to one chat agent (matches origin.agent_id). Cannot be combined with filter_contains. */
  agent_id?: string;
  /** Add a tool_call step that loads the extracted text (file_load_context) before processing. */
  load_content?: boolean;
  /** Add a tool_call step that loads the structured tables (file_tables overview). */
  load_tables?: boolean;
  /** Custom processing steps, run in order after the loaders (file.ready workflow only). */
  steps?: ProcessStep[];
  /** Send a reply to the file's origin at the end. Default true. */
  reply?: boolean;
  /** Binding path of the reply text. Default signal.payload.summary. */
  message_binding?: string;
  enabled?: boolean;
};

export type WorkflowBody = Record<string, unknown> & { name: string };

type GraphNode = { id: string; type: string; config: Record<string, unknown> };

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "step";
}

function toolCallNode(id: string, step: ProcessStep): GraphNode {
  const toolName = step.tool_name.trim();
  const bindings = Object.entries(step.input ?? {}).map(([to, from]) => ({ from, to }));
  return {
    id,
    type: "tool_call",
    config: {
      label: step.label?.trim() || toolName,
      tool_name: toolName,
      // The runtime reads input_bindings as a JSON string (see workflow packs).
      input_bindings: JSON.stringify(bindings),
      output_key: step.output_key?.trim() || `context.${slug(toolName).replace(/-/g, "_")}_result`,
      ...(step.continue_on_error === false ? {} : { continue_on_error: true }),
    },
  };
}

function replyNode(id: string, messageBinding: string): GraphNode {
  return {
    id,
    type: "file_artifact",
    config: {
      operation: "reply_origin",
      file_id_binding: "signal.payload.file_id",
      query_bindings: [{ from: messageBinding, to: "message", required: true }],
      output_key: "context.reply",
      continue_on_error: true,
      retry_policy: { max_attempts: 3, backoff_seconds: 5 },
    },
  };
}

export function validateFileWorkflowOptions(opts: FileWorkflowOptions): string[] {
  const problems: string[] = [];
  const events = opts.events ?? ["file.ready", "file.failed"];
  if (events.length === 0) problems.push("events must not be empty");
  for (const event of events) {
    if (!(FILE_EVENT_TYPES as readonly string[]).includes(event)) {
      problems.push(`unknown event ${JSON.stringify(event)}; use one of ${FILE_EVENT_TYPES.join(", ")}`);
    }
  }
  if (opts.agent_id?.trim() && opts.filter_contains?.trim()) {
    problems.push("use either agent_id or filter_contains (a rule has one substring filter)");
  }
  for (const [index, step] of (opts.steps ?? []).entries()) {
    if (!step.tool_name?.trim()) problems.push(`steps[${index}].tool_name is required`);
    if (step.tool_name && /^(watcher|evaluator|guardian|orchestrator|recorder)$/i.test(step.tool_name.trim())) {
      problems.push(`steps[${index}] must be a tool, not an engine phase`);
    }
  }
  if ((opts.reply ?? true) === false && (opts.steps ?? []).length === 0 && !opts.load_content && !opts.load_tables) {
    problems.push("nothing to do: enable reply, load_content, load_tables or add steps");
  }
  return problems;
}

/** One ambient-workflow create body per requested event. */
export function buildFileWorkflows(opts: FileWorkflowOptions): WorkflowBody[] {
  const problems = validateFileWorkflowOptions(opts);
  if (problems.length > 0) throw new Error(problems.join("; "));

  const events = [...new Set(opts.events ?? (["file.ready", "file.failed"] as FileEventType[]))];
  const baseName = opts.name?.trim() || "File intake";
  const filter = opts.agent_id?.trim() || opts.filter_contains?.trim() || "";
  const reply = opts.reply ?? true;
  const messageBinding = opts.message_binding?.trim() || "signal.payload.summary";

  return events.map((event) => {
    const nodes: GraphNode[] = [];
    if (event === "file.ready") {
      if (opts.load_content) {
        nodes.push(toolCallNode("load-content", {
          tool_name: "file_load_context",
          label: "Load extracted text",
          input: { file_id: "signal.payload.file_id" },
          output_key: "context.file_content",
        }));
      }
      if (opts.load_tables) {
        nodes.push(toolCallNode("load-tables", {
          tool_name: "file_tables",
          label: "Load tables",
          input: { file_id: "signal.payload.file_id" },
          output_key: "context.file_tables",
        }));
      }
      for (const [index, step] of (opts.steps ?? []).entries()) {
        nodes.push(toolCallNode(`step-${index + 1}-${slug(step.tool_name)}`, step));
      }
    }
    if (reply) nodes.push(replyNode("reply-to-origin", messageBinding));
    nodes.push({ id: "done", type: "do_nothing", config: { label: "Done" } });

    const edges = nodes.slice(0, -1).map((node, i) => ({ from: node.id, to: nodes[i + 1].id, condition: "default" }));
    const suffix = event.replace("file.", "").replace(/_/g, " ");
    const rule: Record<string, unknown> = {
      name: `${baseName}: ${suffix}`,
      enabled: opts.enabled ?? true,
      source_type: FILE_EVENT_SOURCE,
      event_types: [event],
      entity_types: ["file"],
      dedupe_window_seconds: 0,
      cooldown_seconds: 0,
    };
    if (filter) rule.filter_contains = filter;
    return {
      name: `${baseName}: ${suffix}`,
      description: opts.description?.trim() || `Handles ${event} for uploaded files.`,
      enabled: opts.enabled ?? true,
      requires_approval: false,
      workflow_async_enabled: true,
      trigger_rules: [rule],
      workflow_graph: { nodes, edges },
    };
  });
}
