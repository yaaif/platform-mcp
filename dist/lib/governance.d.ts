import { z } from "zod";
import type { Ctx } from "../tools/ctx.js";
declare const channel: z.ZodEnum<["chat", "ambient", "desktop", "email"]>;
export declare const governanceOperation: z.ZodDiscriminatedUnion<"action", [z.ZodObject<{
    action: z.ZodLiteral<"policy_create">;
} & {
    name: z.ZodString;
    policy: z.ZodRecord<z.ZodString, z.ZodUnknown>;
    description: z.ZodOptional<z.ZodString>;
    enabled: z.ZodOptional<z.ZodBoolean>;
    shadow_mode: z.ZodOptional<z.ZodBoolean>;
    is_default: z.ZodOptional<z.ZodBoolean>;
}, "strict", z.ZodTypeAny, {
    name: string;
    action: "policy_create";
    policy: Record<string, unknown>;
    description?: string | undefined;
    enabled?: boolean | undefined;
    shadow_mode?: boolean | undefined;
    is_default?: boolean | undefined;
}, {
    name: string;
    action: "policy_create";
    policy: Record<string, unknown>;
    description?: string | undefined;
    enabled?: boolean | undefined;
    shadow_mode?: boolean | undefined;
    is_default?: boolean | undefined;
}>, z.ZodObject<{
    action: z.ZodLiteral<"policy_update">;
} & {
    id: z.ZodString;
    changes: z.ZodEffects<z.ZodObject<{
        name: z.ZodOptional<z.ZodString>;
        description: z.ZodOptional<z.ZodString>;
        enabled: z.ZodOptional<z.ZodBoolean>;
        shadow_mode: z.ZodOptional<z.ZodBoolean>;
        is_default: z.ZodOptional<z.ZodBoolean>;
        policy: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    }, "strict", z.ZodTypeAny, {
        name?: string | undefined;
        description?: string | undefined;
        enabled?: boolean | undefined;
        policy?: Record<string, unknown> | undefined;
        shadow_mode?: boolean | undefined;
        is_default?: boolean | undefined;
    }, {
        name?: string | undefined;
        description?: string | undefined;
        enabled?: boolean | undefined;
        policy?: Record<string, unknown> | undefined;
        shadow_mode?: boolean | undefined;
        is_default?: boolean | undefined;
    }>, {
        name?: string | undefined;
        description?: string | undefined;
        enabled?: boolean | undefined;
        policy?: Record<string, unknown> | undefined;
        shadow_mode?: boolean | undefined;
        is_default?: boolean | undefined;
    }, {
        name?: string | undefined;
        description?: string | undefined;
        enabled?: boolean | undefined;
        policy?: Record<string, unknown> | undefined;
        shadow_mode?: boolean | undefined;
        is_default?: boolean | undefined;
    }>;
}, "strict", z.ZodTypeAny, {
    id: string;
    action: "policy_update";
    changes: {
        name?: string | undefined;
        description?: string | undefined;
        enabled?: boolean | undefined;
        policy?: Record<string, unknown> | undefined;
        shadow_mode?: boolean | undefined;
        is_default?: boolean | undefined;
    };
}, {
    id: string;
    action: "policy_update";
    changes: {
        name?: string | undefined;
        description?: string | undefined;
        enabled?: boolean | undefined;
        policy?: Record<string, unknown> | undefined;
        shadow_mode?: boolean | undefined;
        is_default?: boolean | undefined;
    };
}>, z.ZodObject<{
    action: z.ZodLiteral<"preset_apply">;
} & {
    id: z.ZodString;
    preset_id: z.ZodString;
}, "strict", z.ZodTypeAny, {
    id: string;
    action: "preset_apply";
    preset_id: string;
}, {
    id: string;
    action: "preset_apply";
    preset_id: string;
}>, z.ZodObject<{
    action: z.ZodLiteral<"policy_delete">;
} & {
    id: z.ZodString;
}, "strict", z.ZodTypeAny, {
    id: string;
    action: "policy_delete";
}, {
    id: string;
    action: "policy_delete";
}>, z.ZodObject<{
    action: z.ZodLiteral<"policy_default">;
} & {
    id: z.ZodString;
}, "strict", z.ZodTypeAny, {
    id: string;
    action: "policy_default";
}, {
    id: string;
    action: "policy_default";
}>, z.ZodObject<{
    action: z.ZodLiteral<"revision_create">;
} & {
    id: z.ZodString;
    policy: z.ZodRecord<z.ZodString, z.ZodUnknown>;
}, "strict", z.ZodTypeAny, {
    id: string;
    action: "revision_create";
    policy: Record<string, unknown>;
}, {
    id: string;
    action: "revision_create";
    policy: Record<string, unknown>;
}>, z.ZodObject<{
    action: z.ZodLiteral<"revision_restore">;
} & {
    id: z.ZodString;
    revision_id: z.ZodString;
}, "strict", z.ZodTypeAny, {
    id: string;
    action: "revision_restore";
    revision_id: string;
}, {
    id: string;
    action: "revision_restore";
    revision_id: string;
}>, z.ZodObject<{
    action: z.ZodLiteral<"exception_create">;
} & {
    kind: z.ZodEnum<["guard_bypass", "classification_reaction"]>;
    data_class: z.ZodOptional<z.ZodString>;
    scope: z.ZodEnum<["tool", "skill", "user"]>;
    target: z.ZodString;
    reason: z.ZodString;
    reaction: z.ZodOptional<z.ZodString>;
    agent_id: z.ZodOptional<z.ZodString>;
    stages: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    bypass_guards: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    expires_at: z.ZodOptional<z.ZodString>;
}, "strict", z.ZodTypeAny, {
    scope: "user" | "tool" | "skill";
    target: string;
    action: "exception_create";
    reason: string;
    kind: "guard_bypass" | "classification_reaction";
    data_class?: string | undefined;
    reaction?: string | undefined;
    agent_id?: string | undefined;
    stages?: string[] | undefined;
    bypass_guards?: string[] | undefined;
    expires_at?: string | undefined;
}, {
    scope: "user" | "tool" | "skill";
    target: string;
    action: "exception_create";
    reason: string;
    kind: "guard_bypass" | "classification_reaction";
    data_class?: string | undefined;
    reaction?: string | undefined;
    agent_id?: string | undefined;
    stages?: string[] | undefined;
    bypass_guards?: string[] | undefined;
    expires_at?: string | undefined;
}>, z.ZodObject<{
    action: z.ZodLiteral<"exception_update">;
} & {
    id: z.ZodString;
    changes: z.ZodEffects<z.ZodObject<{
        reaction: z.ZodOptional<z.ZodString>;
        agent_id: z.ZodOptional<z.ZodString>;
        stages: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        bypass_guards: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        reason: z.ZodOptional<z.ZodString>;
        expires_at: z.ZodOptional<z.ZodString>;
    }, "strict", z.ZodTypeAny, {
        reason?: string | undefined;
        reaction?: string | undefined;
        agent_id?: string | undefined;
        stages?: string[] | undefined;
        bypass_guards?: string[] | undefined;
        expires_at?: string | undefined;
    }, {
        reason?: string | undefined;
        reaction?: string | undefined;
        agent_id?: string | undefined;
        stages?: string[] | undefined;
        bypass_guards?: string[] | undefined;
        expires_at?: string | undefined;
    }>, {
        reason?: string | undefined;
        reaction?: string | undefined;
        agent_id?: string | undefined;
        stages?: string[] | undefined;
        bypass_guards?: string[] | undefined;
        expires_at?: string | undefined;
    }, {
        reason?: string | undefined;
        reaction?: string | undefined;
        agent_id?: string | undefined;
        stages?: string[] | undefined;
        bypass_guards?: string[] | undefined;
        expires_at?: string | undefined;
    }>;
}, "strict", z.ZodTypeAny, {
    id: string;
    action: "exception_update";
    changes: {
        reason?: string | undefined;
        reaction?: string | undefined;
        agent_id?: string | undefined;
        stages?: string[] | undefined;
        bypass_guards?: string[] | undefined;
        expires_at?: string | undefined;
    };
}, {
    id: string;
    action: "exception_update";
    changes: {
        reason?: string | undefined;
        reaction?: string | undefined;
        agent_id?: string | undefined;
        stages?: string[] | undefined;
        bypass_guards?: string[] | undefined;
        expires_at?: string | undefined;
    };
}>, z.ZodObject<{
    action: z.ZodLiteral<"exception_enable">;
} & {
    id: z.ZodString;
}, "strict", z.ZodTypeAny, {
    id: string;
    action: "exception_enable";
}, {
    id: string;
    action: "exception_enable";
}>, z.ZodObject<{
    action: z.ZodLiteral<"exception_disable">;
} & {
    id: z.ZodString;
}, "strict", z.ZodTypeAny, {
    id: string;
    action: "exception_disable";
}, {
    id: string;
    action: "exception_disable";
}>, z.ZodObject<{
    action: z.ZodLiteral<"exception_delete">;
} & {
    id: z.ZodString;
}, "strict", z.ZodTypeAny, {
    id: string;
    action: "exception_delete";
}, {
    id: string;
    action: "exception_delete";
}>, z.ZodObject<{
    action: z.ZodLiteral<"override_decide">;
} & {
    id: z.ZodString;
    decision: z.ZodEnum<["allow", "deny"]>;
    ttl_hours: z.ZodOptional<z.ZodNumber>;
}, "strict", z.ZodTypeAny, {
    id: string;
    action: "override_decide";
    decision: "allow" | "deny";
    ttl_hours?: number | undefined;
}, {
    id: string;
    action: "override_decide";
    decision: "allow" | "deny";
    ttl_hours?: number | undefined;
}>, z.ZodObject<{
    action: z.ZodLiteral<"override_delete">;
} & {
    id: z.ZodString;
}, "strict", z.ZodTypeAny, {
    id: string;
    action: "override_delete";
}, {
    id: string;
    action: "override_delete";
}>, z.ZodObject<{
    action: z.ZodLiteral<"override_reconcile">;
}, "strict", z.ZodTypeAny, {
    action: "override_reconcile";
}, {
    action: "override_reconcile";
}>, z.ZodObject<{
    action: z.ZodLiteral<"rollout_create">;
} & {
    policy_id: z.ZodString;
    revision_id: z.ZodString;
    name: z.ZodString;
    traffic_percent: z.ZodNumber;
    target_agents: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    target_channels: z.ZodOptional<z.ZodArray<z.ZodEnum<["chat", "ambient", "desktop", "email"]>, "many">>;
    started_at: z.ZodOptional<z.ZodString>;
    ended_at: z.ZodOptional<z.ZodString>;
}, "strict", z.ZodTypeAny, {
    name: string;
    action: "rollout_create";
    revision_id: string;
    policy_id: string;
    traffic_percent: number;
    target_agents?: string[] | undefined;
    target_channels?: ("email" | "chat" | "ambient" | "desktop")[] | undefined;
    started_at?: string | undefined;
    ended_at?: string | undefined;
}, {
    name: string;
    action: "rollout_create";
    revision_id: string;
    policy_id: string;
    traffic_percent: number;
    target_agents?: string[] | undefined;
    target_channels?: ("email" | "chat" | "ambient" | "desktop")[] | undefined;
    started_at?: string | undefined;
    ended_at?: string | undefined;
}>, z.ZodObject<{
    action: z.ZodLiteral<"rollout_promote">;
} & {
    id: z.ZodString;
}, "strict", z.ZodTypeAny, {
    id: string;
    action: "rollout_promote";
}, {
    id: string;
    action: "rollout_promote";
}>, z.ZodObject<{
    action: z.ZodLiteral<"rollout_abort">;
} & {
    id: z.ZodString;
}, "strict", z.ZodTypeAny, {
    id: string;
    action: "rollout_abort";
}, {
    id: string;
    action: "rollout_abort";
}>, z.ZodObject<{
    action: z.ZodLiteral<"decision_engine_update">;
} & {
    llm_model_config_id: z.ZodString;
    timeout_seconds: z.ZodNumber;
}, "strict", z.ZodTypeAny, {
    action: "decision_engine_update";
    llm_model_config_id: string;
    timeout_seconds: number;
}, {
    action: "decision_engine_update";
    llm_model_config_id: string;
    timeout_seconds: number;
}>, z.ZodObject<{
    action: z.ZodLiteral<"harness_update">;
} & {
    defaults: z.ZodEffects<z.ZodRecord<z.ZodEnum<["chat", "ambient", "desktop", "email"]>, z.ZodRecord<z.ZodString, z.ZodUnknown>>, Partial<Record<"email" | "chat" | "ambient" | "desktop", Record<string, unknown>>>, Partial<Record<"email" | "chat" | "ambient" | "desktop", Record<string, unknown>>>>;
}, "strict", z.ZodTypeAny, {
    action: "harness_update";
    defaults: Partial<Record<"email" | "chat" | "ambient" | "desktop", Record<string, unknown>>>;
}, {
    action: "harness_update";
    defaults: Partial<Record<"email" | "chat" | "ambient" | "desktop", Record<string, unknown>>>;
}>, z.ZodObject<{
    action: z.ZodLiteral<"budget_update">;
} & {
    monthly_limit_usd: z.ZodNumber;
    soft_limit_percent: z.ZodOptional<z.ZodNumber>;
    over_limit_action: z.ZodOptional<z.ZodEnum<["warn", "route_cheap", "block"]>>;
}, "strict", z.ZodTypeAny, {
    action: "budget_update";
    monthly_limit_usd: number;
    soft_limit_percent?: number | undefined;
    over_limit_action?: "warn" | "route_cheap" | "block" | undefined;
}, {
    action: "budget_update";
    monthly_limit_usd: number;
    soft_limit_percent?: number | undefined;
    over_limit_action?: "warn" | "route_cheap" | "block" | undefined;
}>, z.ZodObject<{
    action: z.ZodLiteral<"agent_policy_update">;
} & {
    id: z.ZodString;
    guardrail_policy_id: z.ZodOptional<z.ZodString>;
    clear_guardrail_policy_mapping: z.ZodOptional<z.ZodBoolean>;
    harness_defaults: z.ZodOptional<z.ZodRecord<z.ZodEnum<["chat", "ambient", "desktop", "email"]>, z.ZodRecord<z.ZodString, z.ZodUnknown>>>;
    clear_harness_defaults: z.ZodOptional<z.ZodBoolean>;
}, "strict", z.ZodTypeAny, {
    id: string;
    action: "agent_policy_update";
    guardrail_policy_id?: string | undefined;
    clear_guardrail_policy_mapping?: boolean | undefined;
    harness_defaults?: Partial<Record<"email" | "chat" | "ambient" | "desktop", Record<string, unknown>>> | undefined;
    clear_harness_defaults?: boolean | undefined;
}, {
    id: string;
    action: "agent_policy_update";
    guardrail_policy_id?: string | undefined;
    clear_guardrail_policy_mapping?: boolean | undefined;
    harness_defaults?: Partial<Record<"email" | "chat" | "ambient" | "desktop", Record<string, unknown>>> | undefined;
    clear_harness_defaults?: boolean | undefined;
}>, z.ZodObject<{
    action: z.ZodLiteral<"runtime_defaults_adopt">;
} & {
    scope: z.ZodEnum<["tenant", "agent"]>;
    agent_id: z.ZodOptional<z.ZodString>;
    channels: z.ZodOptional<z.ZodArray<z.ZodEnum<["chat", "ambient", "desktop", "email"]>, "many">>;
}, "strict", z.ZodTypeAny, {
    scope: "agent" | "tenant";
    action: "runtime_defaults_adopt";
    agent_id?: string | undefined;
    channels?: ("email" | "chat" | "ambient" | "desktop")[] | undefined;
}, {
    scope: "agent" | "tenant";
    action: "runtime_defaults_adopt";
    agent_id?: string | undefined;
    channels?: ("email" | "chat" | "ambient" | "desktop")[] | undefined;
}>, z.ZodObject<{
    action: z.ZodLiteral<"eval_review">;
} & {
    id: z.ZodString;
    status: z.ZodEnum<["candidate", "accepted", "rejected"]>;
}, "strict", z.ZodTypeAny, {
    status: "candidate" | "accepted" | "rejected";
    id: string;
    action: "eval_review";
}, {
    status: "candidate" | "accepted" | "rejected";
    id: string;
    action: "eval_review";
}>]>;
export type GovernanceOperation = z.infer<typeof governanceOperation>;
export declare const resourceSchema: z.ZodEnum<["policies", "policy", "revisions", "presets", "exceptions", "exception", "exception_history", "overrides", "rollouts", "decision_engine", "decision_engine_status", "runtime_status", "harness", "harness_telemetry", "budget", "cost_report", "retention", "runtime_overrides", "eval_candidates", "agent", "agents", "replay", "dry_run", "replay_start"]>;
export type Resource = z.infer<typeof resourceSchema>;
export declare const evaluationSchema: z.ZodObject<{
    policy: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    user_input: z.ZodOptional<z.ZodString>;
    model_output: z.ZodOptional<z.ZodString>;
    session_channel: z.ZodOptional<z.ZodEnum<["chat", "ambient", "desktop", "email"]>>;
    tool_call: z.ZodOptional<z.ZodObject<{
        name: z.ZodString;
        args: z.ZodRecord<z.ZodString, z.ZodUnknown>;
    }, "strict", z.ZodTypeAny, {
        name: string;
        args: Record<string, unknown>;
    }, {
        name: string;
        args: Record<string, unknown>;
    }>>;
    policy_id: z.ZodOptional<z.ZodString>;
    candidate_policy: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    candidate_revision_id: z.ZodOptional<z.ZodString>;
    days: z.ZodOptional<z.ZodNumber>;
    limit: z.ZodOptional<z.ZodNumber>;
}, "strict", z.ZodTypeAny, {
    policy?: Record<string, unknown> | undefined;
    policy_id?: string | undefined;
    user_input?: string | undefined;
    model_output?: string | undefined;
    session_channel?: "email" | "chat" | "ambient" | "desktop" | undefined;
    tool_call?: {
        name: string;
        args: Record<string, unknown>;
    } | undefined;
    candidate_policy?: Record<string, unknown> | undefined;
    candidate_revision_id?: string | undefined;
    days?: number | undefined;
    limit?: number | undefined;
}, {
    policy?: Record<string, unknown> | undefined;
    policy_id?: string | undefined;
    user_input?: string | undefined;
    model_output?: string | undefined;
    session_channel?: "email" | "chat" | "ambient" | "desktop" | undefined;
    tool_call?: {
        name: string;
        args: Record<string, unknown>;
    } | undefined;
    candidate_policy?: Record<string, unknown> | undefined;
    candidate_revision_id?: string | undefined;
    days?: number | undefined;
    limit?: number | undefined;
}>;
export type Selector = {
    evaluation?: z.infer<typeof evaluationSchema>;
    resource: Resource;
    id?: string;
    revision_id?: string;
    limit?: number;
    offset?: number;
    channel?: z.infer<typeof channel>;
    from?: string;
    to?: string;
    status?: string;
    policy_id?: string;
};
export declare const operationNames: ("policy_create" | "policy_update" | "preset_apply" | "policy_delete" | "policy_default" | "revision_create" | "revision_restore" | "exception_create" | "exception_update" | "exception_enable" | "exception_disable" | "exception_delete" | "override_decide" | "override_delete" | "override_reconcile" | "rollout_create" | "rollout_promote" | "rollout_abort" | "decision_engine_update" | "harness_update" | "budget_update" | "agent_policy_update" | "runtime_defaults_adopt" | "eval_review")[];
export declare function identity(ctx: Ctx): Promise<{
    subject: string;
    tenant: string;
    profile: string;
    origin: string;
    permissions: string[];
}>;
export type Identity = Awaited<ReturnType<typeof identity>>;
export declare function permissionsFor(action: string): string[];
export declare function requirePermissions(who: Identity, needed: string[]): void;
export declare function inspectPath(s: Selector): string;
export declare function inspect(ctx: Ctx, who: Identity, selector: Selector): Promise<unknown>;
export declare function bounded(value: unknown, maxChars?: number): unknown;
export declare function route(operation: GovernanceOperation): {
    method: string;
    path: string;
    body?: Record<string, unknown>;
    read: Selector;
};
export declare function changeDiff(before: unknown, operation: GovernanceOperation, body?: Record<string, unknown>): unknown;
export type Step = {
    operation: GovernanceOperation;
    before: unknown;
    requested: unknown;
    validation: unknown[];
    rollback: string;
    diff: unknown;
    status: "pending" | "applying" | "applied" | "failed" | "uncertain";
    result?: unknown;
    verification?: unknown;
    error?: string;
};
export type Proposal = {
    id: string;
    owner: Omit<Identity, "permissions">;
    created_at: string;
    baseline: string;
    review_digest: string;
    status: "preview" | "applying" | "applied" | "partial" | "failed" | "needs_review";
    steps: Step[];
};
export declare function getProposal(ctx: Ctx, who: Identity, proposalId: string): Promise<Proposal>;
export declare function preview(ctx: Ctx, who: Identity, operations: GovernanceOperation[]): Promise<Proposal>;
export declare function apply(ctx: Ctx, proposalId: string, reviewDigest: string, confirm: boolean): Promise<Proposal>;
export {};
