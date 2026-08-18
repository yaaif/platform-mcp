/** Port of admin-ui run-canvas-metrics + canvas jump priority for ops summaries. */
export type RunNodeExecutionLabel = "EXECUTED" | "RUNNING" | "WAITING" | "FAILED" | "PENDING";
export type RunStepStatusCounts = {
    executed: number;
    running: number;
    waiting: number;
    failed: number;
    pending: number;
};
export type RunStepMetricTone = "waiting" | "failed" | "running" | "completed" | "idle";
export type RunPathCurrentStep = {
    node_id: string;
    label: "FAILED" | "RUNNING" | "WAITING";
};
export type RunPathSummary = {
    counts: RunStepStatusCounts;
    coverage: {
        reached: number;
        total: number;
        label: string;
    };
    path: {
        executed: number;
        reached: number;
        label: string;
    };
    current_step: RunPathCurrentStep | null;
    tone: RunStepMetricTone;
    title: string;
    admin_ui_canvas_url?: string;
};
export declare function emptyRunStepStatusCounts(): RunStepStatusCounts;
export declare function totalRunStepCount(counts: RunStepStatusCounts): number;
export declare function reachedRunStepCount(counts: RunStepStatusCounts): number;
export declare function normalizeRunStatus(runStatus: string): string;
export declare function isRunActivelyWaiting(runStatus: string, isTimedWait?: boolean): boolean;
export declare function resolveRunNodeExecutionLabel(input: {
    latestStatus?: string;
    executed: boolean;
    blockStatuses?: string[];
    runIsActivelyWaiting: boolean;
}): RunNodeExecutionLabel;
export declare function describeRunStepMetrics(runStatus: string, counts: RunStepStatusCounts, options?: {
    isTimedWait?: boolean;
}): {
    title: string;
    detail: string;
    tone: RunStepMetricTone;
};
export declare function buildAdminUiCanvasUrl(apiBaseUrl: string, runId: string, currentStepId?: string): string | undefined;
export declare function shapeRunPath(input: {
    run?: unknown;
    apiBaseUrl?: string;
    runId?: string;
}): RunPathSummary | undefined;
export declare function extractAmbientRunId(result: unknown, fallback?: string): string;
