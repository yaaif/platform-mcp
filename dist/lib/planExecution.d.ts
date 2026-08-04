export type PlanExecStep = {
    id: string;
    tool: string;
    arguments?: Record<string, unknown>;
    note?: string;
    status: "pending" | "done" | "failed" | "skipped";
    result_ids?: Record<string, string>;
    error?: string;
    updated_at?: string;
};
export type PlanExecution = {
    slug: string;
    plan_path?: string;
    tenant_id?: string;
    profile_id?: string;
    created_at: string;
    updated_at: string;
    steps: PlanExecStep[];
};
export declare class PlanExecutionStore {
    readonly dir: string;
    constructor(cursorHome: string);
    private file;
    save(exec: PlanExecution): Promise<PlanExecution>;
    get(slug: string): Promise<PlanExecution | null>;
    list(): Promise<{
        slug: string;
        updated_at: string;
        pending: number;
        failed: number;
    }[]>;
    resumeHint(exec: PlanExecution): {
        complete: boolean;
        next_step: PlanExecStep | null;
        remaining: PlanExecStep[];
        completed_count: number;
        total: number;
        collected_ids: any;
    };
}
