/** Engine phases still load via migrate for legacy graphs. Do not author them. */
export const ENGINE_NODE_TYPES = new Set([
    "watcher",
    "evaluator",
    "guardian",
    "orchestrator",
    "recorder",
]);
/** Designer palette / canvas step types (ACTION, MESSAGE, BRANCH, WAIT, HUMAN, TERMINAL). */
export const STEP_NODE_TYPES = new Set([
    "skill",
    "action",
    "tool_call",
    "send_email",
    "if",
    "switch",
    "merge",
    "wait",
    "error",
    "approval",
    "hotl",
    "do_nothing",
]);
export const ENGINE_SPINE_ONLY_WARNING = "workflow_graph is engine-spine-only (watcher/evaluator/guardian/orchestrator/recorder) with no step nodes. Author ACTION/MESSAGE/BRANCH/WAIT/HUMAN/TERMINAL steps instead; engine phases are settings, not canvas steps.";
export function graphNodes(graph) {
    const record = asRecord(graph);
    const raw = record.nodes;
    if (!Array.isArray(raw)) {
        return [];
    }
    const out = [];
    for (const item of raw) {
        const node = asRecord(item);
        const id = asString(node.id);
        const type = asString(node.type).toLowerCase();
        if (!id && !type) {
            continue;
        }
        out.push({ id, type });
    }
    return out;
}
/** True when every typed node is an engine phase and there are no step nodes. */
export function isEngineSpineOnlyGraph(graph) {
    const nodes = graphNodes(graph);
    if (nodes.length === 0) {
        return false;
    }
    let hasEngine = false;
    for (const node of nodes) {
        if (!node.type) {
            continue;
        }
        if (STEP_NODE_TYPES.has(node.type)) {
            return false;
        }
        if (ENGINE_NODE_TYPES.has(node.type)) {
            hasEngine = true;
        }
    }
    return hasEngine;
}
export function asRecord(value) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
        return value;
    }
    return {};
}
export function asString(value) {
    if (typeof value === "string") {
        return value;
    }
    if (typeof value === "number" || typeof value === "boolean") {
        return String(value);
    }
    return "";
}
