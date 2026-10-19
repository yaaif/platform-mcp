import { z } from "zod";
import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  rename,
  writeFile,
  open,
  unlink,
} from "node:fs/promises";
import { join } from "node:path";
import type { Ctx } from "../tools/ctx.js";

const id = z.string().trim().min(1).max(200);
const object = z.record(z.unknown());
const channel = z.enum(["chat", "ambient", "desktop", "email"]);
const defaults = z.record(channel, object);
const policyFields = {
  name: id.optional(),
  description: z.string().max(10000).optional(),
  enabled: z.boolean().optional(),
  shadow_mode: z.boolean().optional(),
  is_default: z.boolean().optional(),
  policy: object.optional(),
};
const exceptionFields = {
  reaction: id.optional(),
  agent_id: id.optional(),
  stages: z.array(id).optional(),
  bypass_guards: z.array(id).optional(),
  reason: z.string().min(1).max(10000).optional(),
  expires_at: z.string().datetime().optional(),
};
const op = <A extends string, T extends z.ZodRawShape>(action: A, fields: T) =>
  z.object({ action: z.literal(action), ...fields }).strict();
// Deliberately exclude policy_file, actor overrides, arbitrary paths, and agent
// fields unrelated to governance. Backend validation remains authoritative.
export const governanceOperation = z.discriminatedUnion("action", [
  op("policy_create", { ...policyFields, name: id, policy: object }),
  op("policy_update", {
    id,
    changes: z
      .object(policyFields)
      .strict()
      .refine((v) => Object.keys(v).length > 0, "empty changes"),
  }),
  op("preset_apply", { id, preset_id: id }),
  op("policy_delete", { id }),
  op("policy_default", { id }),
  op("revision_create", { id, policy: object }),
  op("revision_restore", { id, revision_id: id }),
  op("exception_create", {
    ...exceptionFields,
    kind: z.enum(["guard_bypass", "classification_reaction"]),
    data_class: id.optional(),
    scope: z.enum(["tool", "skill", "user"]),
    target: id,
    reason: id,
  }),
  op("exception_update", {
    id,
    changes: z
      .object(exceptionFields)
      .strict()
      .refine((v) => Object.keys(v).length > 0, "empty changes"),
  }),
  op("exception_enable", { id }),
  op("exception_disable", { id }),
  op("exception_delete", { id }),
  op("override_decide", {
    id,
    decision: z.enum(["allow", "deny"]),
    ttl_hours: z.number().int().min(0).max(8760).optional(),
  }),
  op("override_delete", { id }),
  op("override_reconcile", {}),
  op("rollout_create", {
    policy_id: id,
    revision_id: id,
    name: id,
    traffic_percent: z.number().min(0).max(100),
    target_agents: z.array(id).optional(),
    target_channels: z.array(channel).optional(),
    started_at: z.string().datetime().optional(),
    ended_at: z.string().datetime().optional(),
  }),
  op("rollout_promote", { id }),
  op("rollout_abort", { id }),
  op("decision_engine_update", {
    llm_model_config_id: z.string().max(200),
    timeout_seconds: z.number().int().min(1).max(120),
  }),
  op("harness_update", {
    defaults: defaults.refine(
      (v) => Object.keys(v).length > 0,
      "empty defaults",
    ),
  }),
  op("budget_update", {
    monthly_limit_usd: z.number().min(0).max(10000000),
    soft_limit_percent: z.number().int().min(1).max(100).optional(),
    over_limit_action: z.enum(["warn", "route_cheap", "block"]).optional(),
  }),
  op("agent_policy_update", {
    id,
    guardrail_policy_id: id.optional(),
    clear_guardrail_policy_mapping: z.boolean().optional(),
    harness_defaults: defaults.optional(),
    clear_harness_defaults: z.boolean().optional(),
  }),
  op("runtime_defaults_adopt", {
    scope: z.enum(["tenant", "agent"]),
    agent_id: id.optional(),
    channels: z.array(channel).optional(),
  }),
  op("eval_review", {
    id,
    status: z.enum(["candidate", "accepted", "rejected"]),
  }),
]);
export type GovernanceOperation = z.infer<typeof governanceOperation>;
export const resourceSchema = z.enum([
  "policies",
  "policy",
  "revisions",
  "presets",
  "exceptions",
  "exception",
  "exception_history",
  "overrides",
  "rollouts",
  "decision_engine",
  "decision_engine_status",
  "runtime_status",
  "harness",
  "harness_telemetry",
  "budget",
  "cost_report",
  "retention",
  "runtime_overrides",
  "eval_candidates",
  "agent",
  "agents",
  "replay",
  "dry_run",
  "replay_start",
]);
export type Resource = z.infer<typeof resourceSchema>;
export const evaluationSchema = z
  .object({
    policy: object.optional(),
    user_input: z.string().max(20000).optional(),
    model_output: z.string().max(20000).optional(),
    session_channel: channel.optional(),
    tool_call: z.object({ name: id, args: object }).strict().optional(),
    policy_id: id.optional(),
    candidate_policy: object.optional(),
    candidate_revision_id: id.optional(),
    days: z.number().int().min(1).max(90).optional(),
    limit: z.number().int().min(1).max(1000).optional(),
  })
  .strict();
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
const guardRead = "agent.guardrails.read",
  guardWrite = "agent.guardrails.write";
export const operationNames = governanceOperation.options.map(
  (o) => o.shape.action.value,
);

export async function identity(ctx: Ctx) {
  const session = await ctx.auth.session();
  if (!session?.subject || !session.tokens?.access_token)
    throw new Error("Authenticated user session required");
  const tenant = (session.tenant_id || ctx.cfg.defaultTenantId || "").trim();
  if (!tenant) throw new Error("Select a tenant first");
  const access = await ctx.api.apiJSON<{
    tenant_id: string;
    permissions: string[];
  }>("GET", "/api/rbac/me");
  if (
    access.tenant_id !== tenant ||
    !Array.isArray(access.permissions) ||
    access.permissions.some((p) => typeof p !== "string")
  )
    throw new Error("Cannot establish current tenant permissions");
  return {
    subject: session.subject,
    tenant,
    profile: ctx.cfg.activeProfileId || session.profile_id || "default",
    origin: `${ctx.cfg.apiBaseUrl}|${ctx.cfg.agentBaseUrl}`,
    permissions: access.permissions,
  };
}
export type Identity = Awaited<ReturnType<typeof identity>>;
export function permissionsFor(action: string): string[] {
  if (action === "agent_policy_update")
    return ["agent.agents.read", "agent.agents.write", guardRead];
  if (action === "runtime_defaults_adopt")
    return [guardRead, guardWrite, "agent.agents.read", "agent.agents.write"];
  return [guardRead, guardWrite];
}
export function requirePermissions(who: Identity, needed: string[]) {
  if (needed.some((p) => !who.permissions.includes(p)))
    throw new Error(`Permission denied: requires ${needed.join(", ")}`);
}
function requiredId(value?: string) {
  if (!value || value === "." || value === "..")
    throw new Error("A non-traversing id is required for this resource");
  return encodeURIComponent(value);
}
export function inspectPath(s: Selector): string {
  const target = () => requiredId(s.id);
  let path: string;
  switch (s.resource) {
    case "policies":
      path = "/guardrails/policies";
      break;
    case "policy":
      path = `/guardrails/policies/${target()}`;
      break;
    case "revisions":
      path = `/guardrails/policies/${target()}/revisions`;
      break;
    case "presets":
      path = "/guardrails/presets";
      break;
    case "exceptions":
      path = "/guardrails/exceptions";
      break;
    case "exception":
      path = `/guardrails/exceptions/${target()}`;
      break;
    case "exception_history":
      path = `/guardrails/exceptions/${target()}/history`;
      break;
    case "overrides":
      path = s.id
        ? `/guardrails/overrides/${target()}`
        : "/guardrails/overrides";
      break;
    case "rollouts":
      path = s.id ? `/guardrails/rollouts/${target()}` : "/guardrails/rollouts";
      break;
    case "decision_engine":
      path = "/guardrails/decision-engine/settings";
      break;
    case "decision_engine_status":
      path = "/guardrails/decision-engine/status";
      break;
    case "runtime_status":
      path = "/guardrails/runtime-status";
      break;
    case "harness":
      path = "/harness/settings";
      break;
    case "harness_telemetry":
      path = "/harness/telemetry";
      break;
    case "budget":
      path = "/harness/cost-budget";
      break;
    case "cost_report":
      path = "/harness/cost-report";
      break;
    case "retention":
      path = "/harness/retention";
      break;
    case "runtime_overrides":
      path = "/harness/runtime-overrides/audit";
      break;
    case "eval_candidates":
      path = s.id
        ? `/harness/eval-candidates/${target()}`
        : "/harness/eval-candidates";
      break;
    case "agent":
      path = `/agents/${target()}`;
      break;
    case "agents":
      path = "/agents";
      break;
    case "dry_run":
    case "replay_start":
      throw new Error("Evaluation requires a typed evaluation payload");
    case "replay":
      path = `/guardrails/replay/${target()}`;
      break;
  }
  const query = new URLSearchParams({
    limit: String(Math.min(s.limit ?? 40, 100)),
    offset: String(s.offset ?? 0),
  });
  for (const key of ["channel", "from", "to", "status", "policy_id"] as const)
    if (s[key]) query.set(key, s[key]!);
  return `/api${path}?${query}`;
}
export async function inspect(ctx: Ctx, who: Identity, selector: Selector) {
  requirePermissions(who, [
    selector.resource === "agent" || selector.resource === "agents"
      ? "agent.agents.read"
      : guardRead,
    ...(["replay", "dry_run", "replay_start"].includes(selector.resource)
      ? [guardWrite]
      : []),
  ]);
  if (selector.resource === "dry_run" || selector.resource === "replay_start") {
    const payload = evaluationSchema.parse(selector.evaluation);
    if (selector.resource === "dry_run") {
      if (!payload.policy) throw new Error("policy required for dry run");
      const { policy, user_input, model_output, session_channel, tool_call } =
        payload;
      return ctx.api.agentJSON("POST", "/api/guardrails/dry-run", {
        policy,
        user_input,
        model_output,
        session_channel,
        tool_call,
      });
    }
    if (!payload.policy_id) throw new Error("policy_id required for replay");
    const { policy_id, candidate_policy, candidate_revision_id, days, limit } =
      payload;
    return ctx.api.agentJSON("POST", "/api/guardrails/replay", {
      policy_id,
      candidate_policy,
      candidate_revision_id,
      days,
      limit,
    });
  }
  return ctx.api.agentJSON("GET", inspectPath(selector));
}
export function bounded(value: unknown, maxChars = 30000): unknown {
  const serialized = JSON.stringify(value);
  if (serialized.length <= maxChars) return value;
  return {
    truncated: true,
    total_chars: serialized.length,
    preview: serialized.slice(0, maxChars),
    guidance:
      "Narrow the selector or page the results. This is not a complete policy.",
  };
}

export function route(operation: GovernanceOperation): {
  method: string;
  path: string;
  body?: Record<string, unknown>;
  read: Selector;
} {
  const { action, ...args } = operation;
  const body: Record<string, unknown> = { ...args };
  delete body.id;
  const target = () => requiredId("id" in operation ? operation.id : undefined);
  if (action.startsWith("policy_")) {
    const read: Selector =
      action === "policy_create"
        ? { resource: "policies" }
        : {
            resource: "policy",
            id: "id" in operation ? operation.id : undefined,
          };
    const base = "/api/guardrails/policies";
    switch (operation.action) {
      case "policy_create":
        return { method: "POST", path: base, body, read };
      case "policy_update":
        return {
          method: "PUT",
          path: `${base}/${target()}`,
          body: operation.changes,
          read,
        };
      case "policy_delete":
        return { method: "DELETE", path: `${base}/${target()}`, read };
      case "policy_default":
        return {
          method: "POST",
          path: `${base}/${target()}/default`,
          body: {},
          read,
        };
    }
  }
  if (
    operation.action === "revision_create" ||
    operation.action === "revision_restore"
  )
    return {
      method: "POST",
      path: `/api/guardrails/policies/${target()}/revisions${operation.action === "revision_restore" ? `/${requiredId(operation.revision_id)}/restore` : ""}`,
      body:
        operation.action === "revision_create"
          ? { policy: operation.policy }
          : {},
      read: { resource: "policy", id: operation.id },
    };
  if (operation.action.startsWith("exception_")) {
    const read: Selector =
      operation.action === "exception_create"
        ? { resource: "exceptions" }
        : {
            resource: "exception",
            id: "id" in operation ? operation.id : undefined,
          };
    const base = "/api/guardrails/exceptions";
    if (operation.action === "exception_create")
      return { method: "POST", path: base, body, read };
    if (operation.action === "exception_update")
      return {
        method: "PUT",
        path: `${base}/${target()}`,
        body: operation.changes,
        read,
      };
    if (operation.action === "exception_delete")
      return { method: "DELETE", path: `${base}/${target()}`, read };
    return {
      method: "POST",
      path: `${base}/${target()}/${action === "exception_enable" ? "enable" : "disable"}`,
      body: {},
      read,
    };
  }
  switch (operation.action) {
    case "preset_apply":
      throw new Error("Preset must be resolved during preview");
    case "override_decide":
      return {
        method: "POST",
        path: `/api/guardrails/overrides/${target()}/decide`,
        body,
        read: { resource: "overrides", id: operation.id },
      };
    case "override_delete":
      return {
        method: "DELETE",
        path: `/api/guardrails/overrides/${target()}`,
        read: { resource: "overrides", id: operation.id },
      };
    case "override_reconcile":
      return {
        method: "POST",
        path: "/api/guardrails/overrides/reconcile",
        body: {},
        read: { resource: "overrides" },
      };
    case "rollout_create":
      return {
        method: "POST",
        path: "/api/guardrails/rollouts",
        body,
        read: { resource: "rollouts" },
      };
    case "rollout_promote":
    case "rollout_abort":
      return {
        method: "POST",
        path: `/api/guardrails/rollouts/${target()}/${action === "rollout_promote" ? "promote" : "abort"}`,
        body: {},
        read: { resource: "rollouts", id: operation.id },
      };
    case "decision_engine_update":
      return {
        method: "PUT",
        path: "/api/guardrails/decision-engine/settings",
        body,
        read: { resource: "decision_engine" },
      };
    case "harness_update":
      return {
        method: "PUT",
        path: "/api/harness/settings",
        body,
        read: { resource: "harness" },
      };
    case "budget_update":
      return {
        method: "PUT",
        path: "/api/harness/cost-budget",
        body,
        read: { resource: "budget" },
      };
    case "agent_policy_update":
      return {
        method: "PUT",
        path: `/api/agents/${target()}`,
        body,
        read: { resource: "agent", id: operation.id },
      };
    case "runtime_defaults_adopt":
      return {
        method: "POST",
        path: "/api/harness/runtime-overrides/adopt",
        body,
        read: { resource: "runtime_overrides" },
      };
    case "eval_review":
      return {
        method: "PUT",
        path: `/api/harness/eval-candidates/${target()}`,
        body,
        read: { resource: "eval_candidates", id: operation.id },
      };
  }
  throw new Error(`Unsupported governance action: ${action}`);
}

export function changeDiff(
  before: unknown,
  operation: GovernanceOperation,
  body?: Record<string, unknown>,
): unknown {
  const snapshot =
    before && typeof before === "object"
      ? (before as Record<string, unknown>)
      : {};
  const prior =
    operation.action === "budget_update"
      ? ((snapshot.budget ?? {}) as Record<string, unknown>)
      : snapshot;
  if (
    ["policy_delete", "exception_delete", "override_delete"].includes(
      operation.action,
    )
  )
    return [{ path: "/", before, after: null }];
  if (
    operation.action === "policy_create" ||
    operation.action === "exception_create"
  )
    return [{ path: "/", before: null, after: body }];
  let changes = body;
  if (operation.action === "policy_default") changes = { is_default: true };
  if (
    operation.action === "exception_enable" ||
    operation.action === "exception_disable"
  )
    changes = {
      status: operation.action === "exception_enable" ? "active" : "disabled",
    };
  if (
    [
      "policy_update",
      "harness_update",
      "agent_policy_update",
      "decision_engine_update",
      "budget_update",
      "exception_update",
      "eval_review",
    ].includes(operation.action)
  ) {
    return Object.entries(changes ?? {}).map(([key, after]) => ({
      path: `/${key}`,
      before: prior[key] ?? null,
      after,
    }));
  }
  return {
    command: operation.action,
    arguments: body ?? {},
    before,
    effect:
      "Backend lifecycle action; exact derived effects are verified after apply.",
  };
}

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
  status:
    | "preview"
    | "applying"
    | "applied"
    | "partial"
    | "failed"
    | "needs_review";
  steps: Step[];
};
function proposalFile(ctx: Ctx, proposalId: string) {
  if (!/^[0-9a-f-]{36}$/.test(proposalId))
    throw new Error("Invalid proposal id");
  return join(ctx.cfg.stateHome, "governance-proposals", `${proposalId}.json`);
}
async function save(ctx: Ctx, proposal: Proposal) {
  const path = proposalFile(ctx, proposal.id);
  await mkdir(join(ctx.cfg.stateHome, "governance-proposals"), {
    recursive: true,
    mode: 0o700,
  });
  const tmp = `${path}.${randomUUID()}.tmp`;
  await writeFile(tmp, JSON.stringify(proposal, null, 2), { mode: 0o600 });
  await rename(tmp, path);
}
function owner(who: Identity) {
  const { permissions: _, ...bound } = who;
  return bound;
}
function digest(proposal: Proposal) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        owner: proposal.owner,
        baseline: proposal.baseline,
        steps: proposal.steps.map(
          ({ operation, before, requested, validation, rollback, diff }) => ({
            operation,
            before,
            requested,
            validation,
            rollback,
            diff,
          }),
        ),
      }),
    )
    .digest("hex");
}
export async function getProposal(
  ctx: Ctx,
  who: Identity,
  proposalId: string,
): Promise<Proposal> {
  const proposal: Proposal = JSON.parse(
    await readFile(proposalFile(ctx, proposalId), "utf8"),
  );
  if (
    proposal.id !== proposalId ||
    JSON.stringify(proposal.owner) !== JSON.stringify(owner(who))
  )
    throw new Error(
      "Proposal belongs to a different identity, tenant, profile, or platform",
    );
  if (proposal.review_digest !== digest(proposal))
    throw new Error("Proposal was modified; preview again");
  for (const step of proposal.steps)
    requirePermissions(who, permissionsFor(step.operation.action));
  return proposal;
}
async function state(ctx: Ctx) {
  const value = await ctx.api.agentJSON<{ version: string }>(
    "GET",
    "/api/guardrails/governance-state",
  );
  if (!/^[0-9a-f]{64}$/.test(value.version))
    throw new Error("Backend does not support governance preconditions");
  return value.version;
}
export async function preview(
  ctx: Ctx,
  who: Identity,
  operations: GovernanceOperation[],
): Promise<Proposal> {
  for (const operation of operations)
    requirePermissions(who, permissionsFor(operation.action));
  const baseline = await state(ctx);
  const steps: Step[] = [];
  const targets = new Set<string>();
  for (const input of operations) {
    let operation = input;
    // Validate even when invoked outside MCP (tests, internal callers).
    governanceOperation.parse(operation);
    if (
      operation.action === "runtime_defaults_adopt" &&
      operation.scope === "agent" &&
      !operation.agent_id
    )
      throw new Error("agent_id required for agent scope");
    if (operation.action === "agent_policy_update") {
      if (
        operation.guardrail_policy_id &&
        operation.clear_guardrail_policy_mapping
      )
        throw new Error("Cannot both set and clear policy mapping");
      if (operation.harness_defaults && operation.clear_harness_defaults)
        throw new Error("Cannot both set and clear harness defaults");
      if (
        !operation.guardrail_policy_id &&
        !operation.clear_guardrail_policy_mapping &&
        !operation.harness_defaults &&
        !operation.clear_harness_defaults
      )
        throw new Error("No agent policy changes requested");
      if (operation.guardrail_policy_id)
        await inspect(ctx, who, {
          resource: "policy",
          id: operation.guardrail_policy_id,
        });
    }
    if (operation.action === "preset_apply") {
      const existing = (await inspect(ctx, who, {
        resource: "policy",
        id: operation.id,
      })) as { policy: Record<string, unknown> };
      const transformed = await ctx.api.agentJSON<{
        policy: Record<string, unknown>;
      }>(
        "POST",
        `/api/guardrails/presets/${requiredId(operation.preset_id)}/apply`,
        { policy: existing.policy },
      );
      operation = {
        action: "policy_update",
        id: operation.id,
        changes: { policy: transformed.policy },
      };
    }
    const target = route(operation);
    const key = JSON.stringify(target.read);
    if (targets.has(key))
      throw new Error(
        "Use one operation per target in a proposal; combine field updates or preview the next lifecycle action separately",
      );
    targets.add(key);
    const before = await inspect(ctx, who, target.read);
    const validation: unknown[] = [
      {
        kind: "schema",
        valid: true,
        note: "Lifecycle constraints are revalidated by the backend at apply.",
      },
    ];
    const policy =
      operation.action === "policy_update"
        ? operation.changes.policy
        : "policy" in operation
          ? operation.policy
          : undefined;
    if (policy)
      validation.push({
        kind: "policy",
        result: await ctx.api.agentJSON(
          "POST",
          "/api/guardrails/policies/validate",
          { policy },
        ),
      });
    if (operation.action === "harness_update")
      validation.push({
        kind: "harness",
        result: await ctx.api.agentJSON(
          "POST",
          "/api/harness/settings/validate",
          { defaults: operation.defaults },
        ),
      });
    if (
      operation.action === "agent_policy_update" &&
      operation.harness_defaults
    ) {
      // Validate each channel through the same backend normalization, without
      // changing tenant settings. Agent-specific inheritance remains in before.
      validation.push({
        kind: "harness_structure",
        result: await ctx.api.agentJSON(
          "POST",
          "/api/harness/settings/validate",
          { defaults: operation.harness_defaults },
        ),
      });
    }
    if (operation.action === "harness_update") {
      const validated = validation.find(
        (v) => (v as { kind: string }).kind === "harness",
      ) as { result: { defaults: z.infer<typeof defaults> } };
      operation = { ...operation, defaults: validated.result.defaults };
      target.body = { defaults: operation.defaults };
    }
    steps.push({
      operation,
      before,
      diff: changeDiff(before, operation, target.body),
      requested: target.body ?? { delete: true },
      validation,
      rollback: operation.action.includes("delete")
        ? "Deletion may be irreversible. Restore from this snapshot through a separately reviewed proposal where supported."
        : "Use the before snapshot or policy revision to prepare a separately confirmed compensating proposal; runtime side effects may not be reversible.",
      status: "pending",
    });
  }
  if ((await state(ctx)) !== baseline)
    throw new Error("Configuration changed during preview; preview again");
  if (JSON.stringify(owner(await identity(ctx))) !== JSON.stringify(owner(who)))
    throw new Error(
      "Identity or platform changed during preview; preview again",
    );
  const proposal: Proposal = {
    id: randomUUID(),
    owner: owner(who),
    created_at: new Date().toISOString(),
    baseline,
    review_digest: "",
    status: "preview",
    steps,
  };
  proposal.review_digest = digest(proposal);
  await save(ctx, proposal);
  return proposal;
}

export async function apply(
  ctx: Ctx,
  proposalId: string,
  reviewDigest: string,
  confirm: boolean,
): Promise<Proposal> {
  if (confirm !== true)
    throw new Error(
      "Explicit user confirmation is required after reviewing the preview",
    );
  const who = await identity(ctx);
  const path = proposalFile(ctx, proposalId);
  const lock = await open(`${path}.lock`, "wx", 0o600).catch(() => {
    throw new Error(
      "Proposal is being applied or needs recovery; inspect its status before creating another preview",
    );
  });
  try {
    const proposal = await getProposal(ctx, who, proposalId);
    if (proposal.review_digest !== reviewDigest)
      throw new Error("Review digest does not match the preview");
    if (proposal.status !== "preview") return proposal; // never replay writes
    if ((await state(ctx)) !== proposal.baseline)
      throw new Error("Configuration changed after preview; preview again");
    let baseline = proposal.baseline;
    proposal.status = "applying";
    await save(ctx, proposal);
    for (const step of proposal.steps) {
      let writeSent = false;
      let responseStatus = 0;
      try {
        // Re-resolve identity and access before every operation, including after
        // any long request. Never absorb an external write into the next baseline.
        const current = await identity(ctx);
        if (JSON.stringify(owner(current)) !== JSON.stringify(proposal.owner))
          throw new Error("Identity or tenant changed during apply");
        requirePermissions(current, permissionsFor(step.operation.action));
        step.status = "applying";
        await save(ctx, proposal);
        const target = route(step.operation);
        let nextVersion = "";
        const headers: Record<string, string> = {
          "X-Governance-If-Match": baseline,
          "X-Governance-Proposal-ID": proposal.id,
          "X-Request-ID": proposal.id,
        };
        const before = step.before as { version?: number } | undefined;
        if (
          before?.version &&
          ["policy_update", "revision_restore", "exception_update"].includes(
            step.operation.action,
          )
        )
          headers["If-Match"] = String(before.version);
        writeSent = true;
        step.result = await ctx.api.agentJSON(
          target.method,
          target.path,
          target.body,
          {
            headers,
            expectedContext: proposal.owner,
            onResponse: (response) => {
              responseStatus = response.status;
              nextVersion = response.headers.get("X-Governance-Version") || "";
            },
          },
        );
        step.status = "applied";
        // Save immediately: a lost read-back must never cause the write to repeat.
        await save(ctx, proposal);
        if (!/^[0-9a-f]{64}$/.test(nextVersion))
          throw new Error(
            "Write returned without a post-write version; inspect before making another change",
          );
        baseline = nextVersion;
        let read: Selector = target.read;
        const result = step.result as { id?: string } | undefined;
        if (result?.id && step.operation.action === "policy_create")
          read = { resource: "policy", id: result.id };
        if (result?.id && step.operation.action === "exception_create")
          read = { resource: "exception", id: result.id };
        const deleting = [
          "policy_delete",
          "exception_delete",
          "override_delete",
        ].includes(step.operation.action);
        const readback = deleting
          ? await verifyDeletion(ctx, read)
          : await inspect(ctx, current, read);
        let runtime: unknown;
        try {
          runtime = await inspect(ctx, current, { resource: "runtime_status" });
        } catch (error) {
          runtime = { verified: false, error: String(error) };
        }
        step.verification = {
          persisted_readback: readback,
          runtime_status: runtime,
          runtime_activation: "not_proven_by_configuration_readback",
        };
        await save(ctx, proposal);
      } catch (error) {
        if (step.status !== "applied")
          step.status =
            writeSent && !(responseStatus >= 400 && responseStatus < 500)
              ? "uncertain"
              : "failed";
        step.error = String(error);
        proposal.status = proposal.steps.some((s) => s.status === "applied")
          ? "partial"
          : step.status === "uncertain"
            ? "needs_review"
            : "failed";
        await save(ctx, proposal);
        return proposal;
      }
    }
    proposal.status = "applied";
    await save(ctx, proposal);
    return proposal;
  } finally {
    await lock.close();
    await unlink(`${path}.lock`);
  }
}

async function verifyDeletion(ctx: Ctx, selector: Selector) {
  let status = 0;
  try {
    await ctx.api.agentJSON("GET", inspectPath(selector), undefined, {
      onResponse: (response) => {
        status = response.status;
      },
    });
  } catch (error) {
    if (status === 404) return { deleted: true, readback_status: status };
    throw error;
  }
  throw new Error(
    "Delete acknowledged but resource is still readable; inspect before another change",
  );
}
