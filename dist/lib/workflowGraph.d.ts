/** Engine phases still load via migrate for legacy graphs. Do not author them. */
export declare const ENGINE_NODE_TYPES: Set<string>;
/** Designer palette / canvas step types (ACTION, MESSAGE, BRANCH, WAIT, HUMAN, TERMINAL). */
export declare const STEP_NODE_TYPES: Set<string>;
export declare const ENGINE_SPINE_ONLY_WARNING = "workflow_graph is engine-spine-only (watcher/evaluator/guardian/orchestrator/recorder) with no step nodes. Author ACTION/MESSAGE/BRANCH/WAIT/HUMAN/TERMINAL steps instead; engine phases are settings, not canvas steps.";
export declare function graphNodes(graph: unknown): Array<{
    id: string;
    type: string;
}>;
/** True when every typed node is an engine phase and there are no step nodes. */
export declare function isEngineSpineOnlyGraph(graph: unknown): boolean;
export declare function asRecord(value: unknown): Record<string, unknown>;
export declare function asString(value: unknown): string;
