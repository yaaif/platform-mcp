/** Bound ops/telemetry MCP responses so agents do not drown in timeline dumps. */
export type OpsShapeOptions = {
    /** Prefer compact failures/links when result looks like correlate/analyze. */
    summary_only?: boolean;
    /** Soft cap on JSON string length of the shaped payload. */
    max_chars?: number;
    /** Cap arrays named items/messages/events/logs/failures/timeline. */
    max_items?: number;
};
export declare function shapeOpsPayload(result: unknown, opts?: OpsShapeOptions): unknown;
