export declare function skillBranchPath(path: string, branch?: string): string;
export declare function safeSkillPath(value: string): boolean;
export type SkillIssue = {
    source: "validation" | "security";
    severity: string;
    path: string;
    line?: number;
    column?: number;
    message: string;
    remediation?: string;
    category?: string;
    id?: string;
};
export type ValidationResult = {
    branch?: string;
    workspace_fingerprint?: string;
    status?: string;
    checked_files?: number;
    failure_count?: number;
    warning_count?: number;
    issues?: Array<{
        path?: string;
        severity?: string;
        line?: number;
        column?: number;
        category?: string;
        message?: string;
    }>;
    failures?: Array<{
        path?: string;
        message?: string;
    }>;
};
export type SecurityScan = {
    id?: string;
    ref?: string;
    status?: string;
    digest?: string;
    workspace_fingerprint?: string;
    profile_digest?: string;
    eligible?: boolean;
    error?: string;
    error_code?: string;
    report?: {
        complete?: boolean;
        llm_complete?: boolean;
        issues?: Array<{
            id?: string;
            severity?: string;
            explanation?: string;
            remediation?: string;
            location?: {
                file?: string;
                start_line?: number;
            };
        }>;
    };
};
export declare function skillIssues(validation: ValidationResult, scan?: SecurityScan): SkillIssue[];
export declare function skillRepairSteps(branch: string, paths: string[], goal?: string): {
    branch: string;
    requested_improvement: string;
    affected_files: string[];
    steps: string[];
};
