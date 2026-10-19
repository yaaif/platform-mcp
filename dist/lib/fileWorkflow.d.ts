/**
 * Builders for "file workflows": ambient workflows triggered by the platform's
 * file events (source "file": file.ready / file.failed / file.review_decided) that
 * read the extracted file, do custom processing and reply to where the file came from.
 *
 * Pure functions (no I/O) so every IDE, OpenCode and the tests share one definition.
 * Reference: agent-service/docs/file-workflows.md.
 */
export declare const FILE_EVENT_SOURCE = "file";
export declare const FILE_EVENT_TYPES: readonly ["file.ready", "file.failed", "file.review_decided"];
export type FileEventType = (typeof FILE_EVENT_TYPES)[number];
/** Payload fields a trigger / binding can use (signal.payload.*). */
export declare const FILE_EVENT_PAYLOAD_FIELDS: readonly ["file_id", "name", "mime_type", "status", "run_id", "data_class", "quality_score", "extracted_chars", "review_status", "summary", "error", "origin.channel", "origin.session_id", "origin.user_id", "origin.agent_id", "origin.source", "session_id", "chat_session_id"];
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
export type WorkflowBody = Record<string, unknown> & {
    name: string;
};
export declare function validateFileWorkflowOptions(opts: FileWorkflowOptions): string[];
/** One ambient-workflow create body per requested event. */
export declare function buildFileWorkflows(opts: FileWorkflowOptions): WorkflowBody[];
