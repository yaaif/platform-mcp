/** Bound ops/telemetry MCP responses so agents do not drown in timeline dumps. */
const DEFAULT_MAX_CHARS = 48_000;
const DEFAULT_MAX_ITEMS = 40;
export function shapeOpsPayload(result, opts = {}) {
    const maxChars = opts.max_chars && opts.max_chars > 0 ? opts.max_chars : DEFAULT_MAX_CHARS;
    const maxItems = opts.max_items && opts.max_items > 0 ? opts.max_items : DEFAULT_MAX_ITEMS;
    let shaped = result;
    if (opts.summary_only && isRecord(result)) {
        shaped = summarizeOpsRecord(result);
    }
    shaped = boundArrays(shaped, maxItems);
    const encoded = safeStringify(shaped);
    if (encoded.length <= maxChars) {
        return shaped;
    }
    return {
        truncated: true,
        max_chars: maxChars,
        preview: encoded.slice(0, maxChars) + "…",
        hint: "Pass summary_only=true or lower limit; use include_raw only when needed.",
    };
}
function summarizeOpsRecord(result) {
    const out = {
        diagnostics_version: result.diagnostics_version,
        seed: result.seed,
        links: result.links,
        status: result.status,
        failures: result.failures,
        next_steps: result.next_steps,
        partial_errors: result.partial_errors,
        include_raw: result.include_raw,
        cache_hit: result.cache_hit,
        analyzed_at: result.analyzed_at,
        count: result.count,
        total: result.total,
        session_id: result.session_id,
        request_id: result.request_id,
        desktop_run_id: result.desktop_run_id,
        ambient_run_id: result.ambient_run_id,
    };
    // Keep bounded item lists when present (already summaries from server).
    for (const key of ["items", "messages", "events", "logs", "timeline"]) {
        if (Array.isArray(result[key])) {
            out[key] = result[key];
        }
    }
    // Drop heavy raw blobs in summary mode.
    return stripUndefined(out);
}
function boundArrays(value, maxItems) {
    if (Array.isArray(value)) {
        if (value.length <= maxItems) {
            return value.map((v) => boundArrays(v, maxItems));
        }
        return {
            items: value.slice(0, maxItems).map((v) => boundArrays(v, maxItems)),
            truncated_items: true,
            original_count: value.length,
        };
    }
    if (!isRecord(value)) {
        return value;
    }
    const out = {};
    for (const [k, v] of Object.entries(value)) {
        if (Array.isArray(v) &&
            ["items", "messages", "events", "logs", "failures", "timeline", "next_steps"].includes(k)) {
            if (v.length > maxItems) {
                out[k] = v.slice(0, maxItems).map((item) => boundArrays(item, maxItems));
                out[`${k}_truncated`] = true;
                out[`${k}_original_count`] = v.length;
            }
            else {
                out[k] = v.map((item) => boundArrays(item, maxItems));
            }
            continue;
        }
        out[k] = boundArrays(v, maxItems);
    }
    return out;
}
function isRecord(v) {
    return Boolean(v) && typeof v === "object" && !Array.isArray(v);
}
function stripUndefined(obj) {
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
        if (v !== undefined)
            out[k] = v;
    }
    return out;
}
function safeStringify(v) {
    try {
        return JSON.stringify(v) ?? "";
    }
    catch {
        return String(v);
    }
}
