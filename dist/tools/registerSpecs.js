import { z } from "zod";
import { fail, ok } from "./helpers.js";
const slotSchema = z.object({
    slot_key: z.string(),
    kind: z.string(),
    expected_name: z.string().optional(),
    notes: z.string().optional(),
    requirement_keys: z.array(z.string()).optional(),
    status: z.string().optional(),
    sort_order: z.number().optional(),
});
const requirementSchema = z.object({
    req_key: z.string(),
    title: z.string(),
    statement: z.string().optional(),
    priority: z.enum(["must", "should", "could"]).optional(),
    category: z.string().optional(),
    acceptance_criteria: z.array(z.string()).optional(),
    status: z.string().optional(),
    sort_order: z.number().int().nonnegative().optional(),
});
const segmentSchema = z.object({
    segment_key: z.string(),
    title: z.string().optional(),
    body_md: z.string().optional(),
    payload: z.record(z.unknown()).optional(),
    status: z.string().optional(),
    sort_order: z.number().optional(),
});
const expectedVersionSchema = z.number().int().positive();
function specPath(specId, suffix = "") {
    return `/api/agent-specs/${encodeURIComponent(specId)}${suffix}`;
}
export function registerSpecTools(server, ctx) {
    server.registerTool("yaaif_agent_spec_policy_get", {
        description: "Read the tenant Scenario enforcement mode. New tenants default to observe.",
        inputSchema: {},
    }, async () => {
        try {
            return ok("Fetched Scenario enforcement policy.", {
                policy: await ctx.api.agentJSON("GET", "/api/agent-specs/policy"),
            });
        }
        catch (e) {
            return fail(String(e));
        }
    });
    server.registerTool("yaaif_agent_spec_policy_set", {
        description: "Promote the active tenant from observe to warn or require after adoption inventory review.",
        inputSchema: { mode: z.enum(["observe", "warn", "require"]) },
    }, async ({ mode }) => {
        try {
            return ok(`Set Scenario enforcement mode to ${mode}.`, {
                policy: await ctx.api.agentJSON("PUT", "/api/agent-specs/policy", {
                    mode,
                }),
            });
        }
        catch (e) {
            return fail(String(e));
        }
    });
    server.registerTool("yaaif_agent_spec_untracked_list", {
        description: "Inventory untracked catalog objects discovered in observe/warn mode. Map selected objects explicitly before adoption; never auto-create a Scenario.",
        inputSchema: { limit: z.number().int().positive().max(200).optional() },
    }, async ({ limit }) => {
        try {
            const suffix = limit ? `?limit=${limit}` : "";
            return ok("Listed untracked Scenario candidates.", {
                result: await ctx.api.agentJSON("GET", `/api/agent-specs/untracked${suffix}`),
            });
        }
        catch (e) {
            return fail(String(e));
        }
    });
    server.registerTool("yaaif_agent_spec_create", {
        description: "Create a tenant Scenario (Agent Spec): requirement segments + architecture slots. Admin UI calls this a scenario. Pass the returned spec_id on later create tools.",
        inputSchema: {
            slug: z.string(),
            name: z.string(),
            description: z.string().optional(),
            status: z.string().optional(),
            segments: z.array(segmentSchema).optional(),
            requirements: z.array(requirementSchema).optional(),
            slots: z.array(slotSchema).optional(),
        },
    }, async (args) => {
        try {
            const spec = await ctx.api.agentJSON("POST", "/api/agent-specs", {
                slug: args.slug,
                name: args.name,
                description: args.description ?? "",
                status: args.status ?? "approved",
                source: "cursor_plugin",
                segments: args.segments ?? [],
                requirements: args.requirements ?? [],
                slots: args.slots ?? [],
            });
            return ok(`Created scenario ${args.slug}.`, { spec });
        }
        catch (e) {
            return fail(String(e));
        }
    });
    server.registerTool("yaaif_agent_spec_policy_export", {
        description: "Export the portable Scenario tenant policy document for review or promotion across environments.",
        inputSchema: {},
    }, async () => {
        try {
            return ok("Exported Scenario policy.", {
                document: await ctx.api.agentJSON("GET", "/api/agent-specs/policy/export"),
            });
        }
        catch (e) {
            return fail(String(e));
        }
    });
    server.registerTool("yaaif_agent_spec_policy_import", {
        description: "Import a reviewed version-1 Scenario tenant policy document. This controls enforcement, evidence TTL, and high-assurance override approval.",
        inputSchema: {
            document: z.union([
                z.object({
                    version: z.literal(1),
                    mode: z.enum(["observe", "warn", "require"]),
                    evidence_ttl_days: z.number().int().min(0).max(3650),
                    require_second_approver: z.boolean(),
                }),
                z.object({
                    version: z.literal(2),
                    mode: z.enum(["observe", "warn", "require"]),
                    evidence_ttl_days: z.number().int().min(0).max(3650),
                    require_second_approver: z.boolean(),
                    release_governance_enabled: z.boolean(),
                    require_major_release_approval: z.boolean(),
                    require_restore_approval: z.boolean(),
                    release_approval_strategy_id: z.string().optional(),
                    block_incompatible_release_dependencies: z.boolean(),
                }),
            ]),
        },
    }, async ({ document }) => {
        try {
            return ok("Imported Scenario policy.", {
                policy: await ctx.api.agentJSON("PUT", "/api/agent-specs/policy/import", { document }),
            });
        }
        catch (e) {
            return fail(String(e));
        }
    });
    server.registerTool("yaaif_agent_spec_untracked_resolve", {
        description: "Explicitly close an untracked inventory item as ignored or adopted. Adoption requires the Scenario id after its mapped bindings were reviewed.",
        inputSchema: {
            object_id: z.string(),
            state: z.enum(["ignored", "adopted"]),
            spec_id: z.string().optional(),
        },
    }, async ({ object_id, state, spec_id }) => {
        try {
            return ok(`Marked untracked object ${state}.`, {
                result: await ctx.api.agentJSON("POST", `/api/agent-specs/untracked/${encodeURIComponent(object_id)}/resolve`, { state, spec_id: spec_id ?? "" }),
            });
        }
        catch (e) {
            return fail(String(e));
        }
    });
    server.registerTool("yaaif_agent_spec_drift_scan", {
        description: "Run a non-destructive Scenario drift scan. It records readiness conflicts only; use sync preview/apply to resolve them.",
        inputSchema: { limit: z.number().int().positive().max(500).optional() },
    }, async ({ limit }) => {
        try {
            const suffix = limit ? `?limit=${limit}` : "";
            return ok("Completed non-destructive Scenario drift scan.", {
                result: await ctx.api.agentJSON("POST", `/api/agent-specs/drift-scan${suffix}`),
            });
        }
        catch (e) {
            return fail(String(e));
        }
    });
    server.registerTool("yaaif_agent_spec_rollout_metrics", {
        description: "Read observe/warn/require rollout metrics: untracked mutations, readiness failures, overrides, sync conflicts, and verification failures.",
        inputSchema: {},
    }, async () => {
        try {
            return ok("Fetched Scenario rollout metrics.", {
                metrics: await ctx.api.agentJSON("GET", "/api/agent-specs/rollout-metrics"),
            });
        }
        catch (e) {
            return fail(String(e));
        }
    });
    server.registerTool("yaaif_agent_spec_list", {
        description: "List Scenarios (Agent Specs) for the active tenant.",
        inputSchema: {
            q: z.string().optional(),
            status: z.string().optional(),
            limit: z.number().optional(),
        },
    }, async (args) => {
        const params = new URLSearchParams();
        if (args.q)
            params.set("q", args.q);
        if (args.status)
            params.set("status", args.status);
        if (args.limit)
            params.set("limit", String(args.limit));
        const path = `/api/agent-specs${params.size ? `?${params}` : ""}`;
        try {
            return ok("Listed scenarios.", {
                result: await ctx.api.agentJSON("GET", path),
            });
        }
        catch (e) {
            return fail(String(e));
        }
    });
    server.registerTool("yaaif_agent_spec_get", {
        description: "Load one Scenario (Agent Spec) by id or slug, including segments, slots, bindings, and workflow_design.",
        inputSchema: { spec_id: z.string() },
    }, async ({ spec_id }) => {
        try {
            return ok("Fetched scenario.", {
                spec: await ctx.api.agentJSON("GET", specPath(spec_id)),
            });
        }
        catch (e) {
            return fail(String(e));
        }
    });
    server.registerTool("yaaif_agent_spec_update", {
        description: "Update Scenario identity or segments using the version returned from its last read. Requirement and slot replacement is only allowed with replace_all=true; prefer granular tools.",
        inputSchema: {
            spec_id: z.string(),
            expected_version: expectedVersionSchema,
            name: z.string().optional(),
            description: z.string().optional(),
            status: z.string().optional(),
            segments: z.array(segmentSchema).optional(),
            requirements: z.array(requirementSchema).optional(),
            slots: z.array(slotSchema).optional(),
            replace_all: z.boolean().optional(),
        },
    }, async (args) => {
        const body = {};
        body.expected_version = args.expected_version;
        if (args.name !== undefined)
            body.name = args.name;
        if (args.description !== undefined)
            body.description = args.description;
        if (args.status !== undefined)
            body.status = args.status;
        if (args.segments !== undefined)
            body.segments = args.segments;
        if (args.requirements !== undefined)
            body.requirements = args.requirements;
        if (args.slots !== undefined)
            body.slots = args.slots;
        if (args.replace_all !== undefined)
            body.replace_all = args.replace_all;
        try {
            return ok("Updated scenario.", {
                spec: await ctx.api.agentJSON("PUT", specPath(args.spec_id), body),
            });
        }
        catch (e) {
            return fail(String(e));
        }
    });
    server.registerTool("yaaif_agent_spec_update_segment", {
        description: "Update one Scenario segment (overview, architecture, workflow_design, benefits, …).",
        inputSchema: {
            spec_id: z.string(),
            expected_version: expectedVersionSchema,
            segment_key: z.string(),
            title: z.string().optional(),
            body_md: z.string().optional(),
            payload: z.record(z.unknown()).optional(),
            status: z.string().optional(),
            sort_order: z.number().optional(),
        },
    }, async (args) => {
        const body = {
            segment_key: args.segment_key,
            expected_version: args.expected_version,
        };
        if (args.title !== undefined)
            body.title = args.title;
        if (args.body_md !== undefined)
            body.body_md = args.body_md;
        if (args.payload !== undefined)
            body.payload = args.payload;
        if (args.status !== undefined)
            body.status = args.status;
        if (args.sort_order !== undefined)
            body.sort_order = args.sort_order;
        try {
            return ok(`Updated scenario segment ${args.segment_key}.`, {
                spec: await ctx.api.agentJSON("PUT", specPath(args.spec_id, `/segments/${encodeURIComponent(args.segment_key)}`), body),
            });
        }
        catch (e) {
            return fail(String(e));
        }
    });
    server.registerTool("yaaif_agent_spec_upsert_slots", {
        description: "Explicitly replace every architecture slot. Prefer yaaif_agent_spec_upsert_slot for normal edits.",
        inputSchema: {
            spec_id: z.string(),
            expected_version: expectedVersionSchema,
            slots: z.array(slotSchema),
        },
    }, async ({ spec_id, expected_version, slots }) => {
        try {
            return ok("Upserted scenario slots.", {
                spec: await ctx.api.agentJSON("PUT", specPath(spec_id, "/slots"), {
                    expected_version,
                    replace_all: true,
                    slots,
                }),
            });
        }
        catch (e) {
            return fail(String(e));
        }
    });
    server.registerTool("yaaif_agent_spec_bind", {
        description: "Bind a live catalog entity to a Scenario architecture slot. Default source is agent_spec (created/maintained from this scenario).",
        inputSchema: {
            spec_id: z.string(),
            expected_version: expectedVersionSchema,
            slot_key: z.string(),
            entity_id: z.string(),
            kind: z.string().optional(),
            entity_name: z.string().optional(),
            plan_slug: z.string().optional(),
            source: z.string().optional(),
        },
    }, async (args) => {
        try {
            return ok(`Bound ${args.slot_key} to ${args.entity_id}.`, {
                spec: await ctx.api.agentJSON("POST", specPath(args.spec_id, "/bindings"), {
                    slot_key: args.slot_key,
                    expected_version: args.expected_version,
                    kind: args.kind,
                    entity_id: args.entity_id,
                    entity_name: args.entity_name ?? "",
                    source: args.source || "agent_spec",
                    plan_slug: args.plan_slug ?? "",
                }),
            });
        }
        catch (e) {
            return fail(String(e));
        }
    });
    server.registerTool("yaaif_agent_spec_sync_workflow_design", {
        description: "Copy bound ambient workflow graphs into the Scenario workflow_design segment. This is an explicit adopt of live graphs. Prefer yaaif_agent_spec_sync_to_objects to apply Scenario-owned workflow_design onto catalog objects.",
        inputSchema: {
            spec_id: z.string(),
            expected_version: expectedVersionSchema,
        },
    }, async ({ spec_id, expected_version }) => {
        try {
            return ok("Synced scenario workflow_design.", {
                spec: await ctx.api.agentJSON("POST", specPath(spec_id, "/workflow-design/sync"), { expected_version }),
            });
        }
        catch (e) {
            return fail(String(e));
        }
    });
    server.registerTool("yaaif_agent_spec_sync_from_objects", {
        description: "Adopt live catalog objects into the Scenario (explicit). Overwrites Scenario-owned names and workflow graphs. Preview with yaaif_agent_spec_sync_preview (from_objects), then apply. Not the default finish step after create/bind.",
        inputSchema: {
            spec_id: z.string(),
            expected_version: expectedVersionSchema,
            preview_id: z.string().uuid(),
        },
    }, async ({ spec_id, expected_version, preview_id }) => {
        try {
            return ok("Synced scenario from catalog objects.", {
                sync: await ctx.api.agentJSON("POST", specPath(spec_id, "/sync-apply"), { direction: "from_objects", expected_version, preview_id }),
            });
        }
        catch (e) {
            return fail(String(e));
        }
    });
    server.registerTool("yaaif_agent_spec_sync_to_objects", {
        description: "Apply Scenario-owned names and workflow_design onto bound catalog objects. Preview with yaaif_agent_spec_sync_preview (to_objects), then apply. Skill pack files are not overwritten.",
        inputSchema: {
            spec_id: z.string(),
            expected_version: expectedVersionSchema,
            preview_id: z.string().uuid(),
        },
    }, async ({ spec_id, expected_version, preview_id }) => {
        try {
            return ok("Synced catalog objects from scenario.", {
                sync: await ctx.api.agentJSON("POST", specPath(spec_id, "/sync-apply"), { direction: "to_objects", expected_version, preview_id }),
            });
        }
        catch (e) {
            return fail(String(e));
        }
    });
    server.registerTool("yaaif_agent_spec_adopt", {
        description: "Apply a previously reviewed adoption preview. Existing authored Scenario prose is preserved and a baseline revision is published.",
        inputSchema: {
            spec_id: z.string(),
            expected_version: expectedVersionSchema,
        },
    }, async ({ spec_id, expected_version }) => {
        try {
            return ok("Adopted catalog objects onto this scenario.", {
                spec: await ctx.api.agentJSON("POST", specPath(spec_id, "/adopt-created"), { expected_version }),
            });
        }
        catch (e) {
            return fail(String(e));
        }
    });
    server.registerTool("yaaif_agent_spec_publish", {
        description: "Publish an immutable semantic Scenario release. Use patch for corrections, minor for compatible capability additions, and major for breaking architecture or requirement changes.",
        inputSchema: {
            spec_id: z.string(),
            expected_version: expectedVersionSchema,
            release_kind: z.enum(["patch", "minor", "major"]).optional(),
            release_channel: z.enum(["stable", "candidate"]).optional(),
            change_summary: z.string().max(2000).optional(),
        },
    }, async ({ spec_id, expected_version, release_kind, release_channel, change_summary }) => {
        try {
            return ok("Published scenario revision.", {
                spec: await ctx.api.agentJSON("POST", specPath(spec_id, "/revisions"), { expected_version, release_kind: release_kind ?? "patch", release_channel: release_channel ?? "stable", change_summary: change_summary ?? "" }),
            });
        }
        catch (e) {
            return fail(String(e));
        }
    });
    server.registerTool("yaaif_agent_spec_revisions", {
        description: "List immutable Scenario releases with SemVer, parent revision, content hash, change summary, and author.",
        inputSchema: { spec_id: z.string() },
    }, async ({ spec_id }) => {
        try {
            return ok("Listed Scenario releases.", {
                revisions: await ctx.api.agentJSON("GET", specPath(spec_id, "/revisions")),
            });
        }
        catch (e) {
            return fail(String(e));
        }
    });
    server.registerTool("yaaif_agent_spec_revision_compare", {
        description: "Compare two immutable Scenario releases at the identity, segment, requirement, and slot level before restoring or promoting a change.",
        inputSchema: {
            spec_id: z.string(),
            from_revision: z.number().int().positive(),
            to_revision: z.number().int().positive(),
        },
    }, async ({ spec_id, from_revision, to_revision }) => {
        try {
            return ok("Compared Scenario releases.", {
                diff: await ctx.api.agentJSON("GET", `${specPath(spec_id, "/revisions/compare")}?from_revision=${from_revision}&to_revision=${to_revision}`),
            });
        }
        catch (e) {
            return fail(String(e));
        }
    });
    server.registerTool("yaaif_agent_spec_revision_restore", {
        description: "Restore an immutable Scenario release into a new draft. Historical releases are never altered; review and publish the restored draft as a new semantic release.",
        inputSchema: {
            spec_id: z.string(),
            revision: z.number().int().positive(),
            expected_version: expectedVersionSchema,
            change_summary: z.string().max(2000).optional(),
        },
    }, async ({ spec_id, revision, expected_version, change_summary }) => {
        try {
            return ok("Restored Scenario release as a draft.", {
                spec: await ctx.api.agentJSON("POST", specPath(spec_id, `/revisions/${revision}/restore`), { expected_version, change_summary: change_summary ?? "" }),
            });
        }
        catch (e) {
            return fail(String(e));
        }
    });
    server.registerTool("yaaif_agent_spec_release_candidate_promote", {
        description: "Promote a verified Scenario release candidate to its stable SemVer release. Promotion creates a fresh immutable stable record and never rewrites the candidate.",
        inputSchema: {
            spec_id: z.string(),
            revision: z.number().int().positive(),
            expected_version: expectedVersionSchema,
            change_summary: z.string().max(2000).optional(),
        },
    }, async ({ spec_id, revision, expected_version, change_summary }) => {
        try {
            return ok("Promoted Scenario release candidate.", {
                spec: await ctx.api.agentJSON("POST", specPath(spec_id, `/revisions/${revision}/promote`), { expected_version, change_summary: change_summary ?? "" }),
            });
        }
        catch (e) {
            return fail(String(e));
        }
    });
    server.registerTool("yaaif_agent_spec_release_approval_request", {
        description: "Request the configured approval-service review for a major Scenario release, a release-candidate promotion, or a restore. This is inactive unless tenant policy v2 explicitly enables release governance.",
        inputSchema: {
            spec_id: z.string(),
            expected_version: expectedVersionSchema,
            action: z.enum(["publish", "restore"]),
            release_kind: z.enum(["patch", "minor", "major"]).optional(),
            restore_revision: z.number().int().positive().optional(),
            candidate_revision: z.number().int().positive().optional(),
            idempotency_key: z.string().max(256).optional(),
        },
    }, async (args) => {
        try {
            return ok("Requested Scenario release approval.", {
                approval: await ctx.api.agentJSON("POST", specPath(args.spec_id, "/revisions/approval-requests"), args),
            });
        }
        catch (e) {
            return fail(String(e));
        }
    });
    server.registerTool("yaaif_agent_spec_release_approvals", {
        description: "List immutable-draft release approval requests and their latest recorded approval-service status.",
        inputSchema: { spec_id: z.string() },
    }, async ({ spec_id }) => {
        try {
            return ok("Listed Scenario release approvals.", {
                approvals: await ctx.api.agentJSON("GET", specPath(spec_id, "/revisions/approval-requests")),
            });
        }
        catch (e) {
            return fail(String(e));
        }
    });
    server.registerTool("yaaif_agent_spec_release_approval_refresh", {
        description: "Refresh one Scenario release approval from approval-service before attempting the governed action.",
        inputSchema: { spec_id: z.string(), approval_id: z.string() },
    }, async ({ spec_id, approval_id }) => {
        try {
            return ok("Refreshed Scenario release approval.", {
                approval: await ctx.api.agentJSON("POST", specPath(spec_id, `/revisions/approval-requests/${encodeURIComponent(approval_id)}/refresh`)),
            });
        }
        catch (e) {
            return fail(String(e));
        }
    });
    server.registerTool("yaaif_agent_spec_release_provenance_record", {
        description: "Record build, isolated verification, artifact, SBOM, or deployment provenance for one immutable Scenario release. A release candidate needs passing verification provenance before promotion.",
        inputSchema: {
            spec_id: z.string(),
            expected_version: expectedVersionSchema,
            revision: z.number().int().positive(),
            kind: z.enum(["build", "verification", "artifact", "sbom", "deployment"]),
            result: z.enum(["recorded", "passed", "failed"]).optional(),
            commit_sha: z.string().max(256).optional(),
            ci_run_url: z.string().url().optional(),
            artifact_digest: z.string().max(512).optional(),
            report_uri: z.string().url().optional(),
            sbom_uri: z.string().url().optional(),
            payload: z.record(z.unknown()).optional(),
        },
    }, async ({ spec_id, ...input }) => {
        try {
            return ok("Recorded Scenario release provenance.", {
                provenance: await ctx.api.agentJSON("POST", specPath(spec_id, "/revisions/provenance"), input),
            });
        }
        catch (e) {
            return fail(String(e));
        }
    });
    server.registerTool("yaaif_agent_spec_release_provenance_list", {
        description: "List build/test/artifact/SBOM/deployment provenance attached to immutable Scenario releases.",
        inputSchema: { spec_id: z.string() },
    }, async ({ spec_id }) => {
        try {
            return ok("Listed Scenario release provenance.", {
                provenance: await ctx.api.agentJSON("GET", specPath(spec_id, "/revisions/provenance")),
            });
        }
        catch (e) {
            return fail(String(e));
        }
    });
    server.registerTool("yaaif_agent_spec_release_export", {
        description: "Export a signed-by-hash Scenario release manifest suitable for committing to Git, review, and disaster recovery.",
        inputSchema: { spec_id: z.string(), revision: z.number().int().positive() },
    }, async ({ spec_id, revision }) => {
        try {
            return ok("Exported Scenario release manifest.", {
                document: await ctx.api.agentJSON("GET", specPath(spec_id, `/revisions/${revision}/export`)),
            });
        }
        catch (e) {
            return fail(String(e));
        }
    });
    server.registerTool("yaaif_agent_spec_release_import", {
        description: "Import a reviewed, hash-verified Scenario release manifest from Git as a new draft. It preserves bound slot identities and never changes release history.",
        inputSchema: {
            spec_id: z.string(),
            expected_version: expectedVersionSchema,
            change_summary: z.string().max(2000).optional(),
            document: z.object({
                format: z.literal("yaaif.agent-spec.release/v1"),
                exported_at: z.string(),
                revision: z.record(z.unknown()),
                snapshot: z.record(z.unknown()),
                provenance: z.array(z.record(z.unknown())),
                manifest_hash: z.string().length(64),
            }),
        },
    }, async ({ spec_id, expected_version, change_summary, document }) => {
        try {
            return ok("Imported Scenario release manifest as a draft.", {
                spec: await ctx.api.agentJSON("POST", specPath(spec_id, "/revisions/import"), { expected_version, change_summary: change_summary ?? "", document }),
            });
        }
        catch (e) {
            return fail(String(e));
        }
    });
    server.registerTool("yaaif_agent_spec_legacy_revision_backfill_preview", {
        description: "Preview legacy release metadata normalization. This is read-only and never runs automatically for any tenant.",
        inputSchema: { spec_id: z.string() },
    }, async ({ spec_id }) => {
        try {
            return ok("Previewed legacy Scenario revision backfill.", {
                preview: await ctx.api.agentJSON("GET", specPath(spec_id, "/revision-backfill/preview")),
            });
        }
        catch (e) {
            return fail(String(e));
        }
    });
    server.registerTool("yaaif_agent_spec_legacy_revision_backfill_apply", {
        description: "Apply a reviewed legacy-release backfill with the exact preview hash. This is an explicit operator action, not tenant rollout automation.",
        inputSchema: { spec_id: z.string(), expected_version: expectedVersionSchema, preview_hash: z.string().length(64) },
    }, async ({ spec_id, expected_version, preview_hash }) => {
        try {
            return ok("Applied legacy Scenario revision backfill.", {
                result: await ctx.api.agentJSON("POST", specPath(spec_id, "/revision-backfill/apply"), { expected_version, preview_hash }),
            });
        }
        catch (e) {
            return fail(String(e));
        }
    });
    server.registerTool("yaaif_agent_spec_release_compatibility", {
        description: "Preview declared dependent-Scenario compatibility with a proposed provider semantic release; policy may optionally block required incompatibilities.",
        inputSchema: { spec_id: z.string(), release_kind: z.enum(["patch", "minor", "major"]).optional() },
    }, async ({ spec_id, release_kind }) => {
        try {
            return ok("Checked Scenario release compatibility.", {
                result: await ctx.api.agentJSON("GET", `${specPath(spec_id, "/release-compatibility")}?release_kind=${release_kind ?? "patch"}`),
            });
        }
        catch (e) {
            return fail(String(e));
        }
    });
    server.registerTool("yaaif_agent_spec_release_dependency_upsert", {
        description: "Declare that this consumer Scenario depends on a provider Scenario release range. The update is version-protected and explicit.",
        inputSchema: { spec_id: z.string(), provider_spec_id: z.string(), expected_version: expectedVersionSchema, version_constraint: z.string().max(128), required: z.boolean().optional() },
    }, async ({ spec_id, provider_spec_id, expected_version, version_constraint, required }) => {
        try {
            return ok("Updated Scenario release dependency.", {
                spec: await ctx.api.agentJSON("PUT", specPath(spec_id, `/release-dependencies/${encodeURIComponent(provider_spec_id)}`), { expected_version, version_constraint, required: required ?? true }),
            });
        }
        catch (e) {
            return fail(String(e));
        }
    });
    server.registerTool("yaaif_agent_spec_release_dependencies", {
        description: "List explicit provider Scenario version constraints declared by this consumer Scenario.",
        inputSchema: { spec_id: z.string() },
    }, async ({ spec_id }) => {
        try {
            return ok("Listed Scenario release dependencies.", {
                dependencies: await ctx.api.agentJSON("GET", specPath(spec_id, "/release-dependencies")),
            });
        }
        catch (e) {
            return fail(String(e));
        }
    });
    server.registerTool("yaaif_agent_spec_release_dependency_delete", {
        description: "Remove one explicit Scenario provider dependency using the current optimistic draft version.",
        inputSchema: { spec_id: z.string(), provider_spec_id: z.string(), expected_version: expectedVersionSchema },
    }, async ({ spec_id, provider_spec_id, expected_version }) => {
        try {
            return ok("Removed Scenario release dependency.", {
                spec: await ctx.api.agentJSON("DELETE", `${specPath(spec_id, `/release-dependencies/${encodeURIComponent(provider_spec_id)}`)}?expected_version=${expected_version}`),
            });
        }
        catch (e) {
            return fail(String(e));
        }
    });
    server.registerTool("yaaif_agent_spec_readiness", {
        description: "Return machine-readable activation/publish blockers, requirement coverage, stale evidence, and pending sync conflicts.",
        inputSchema: { spec_id: z.string() },
    }, async ({ spec_id }) => {
        try {
            return ok("Fetched scenario readiness.", {
                readiness: await ctx.api.agentJSON("GET", specPath(spec_id, "/readiness")),
            });
        }
        catch (e) {
            return fail(String(e));
        }
    });
    server.registerTool("yaaif_agent_spec_dependencies", {
        description: "Return the Scenario dependency graph for change-impact analysis: requirements, slots, bound objects, and evidence.",
        inputSchema: { spec_id: z.string() },
    }, async ({ spec_id }) => {
        try {
            return ok("Fetched Scenario dependency graph.", {
                graph: await ctx.api.agentJSON("GET", specPath(spec_id, "/dependencies")),
            });
        }
        catch (e) {
            return fail(String(e));
        }
    });
    server.registerTool("yaaif_agent_spec_upsert_requirement", {
        description: "Create or update one typed requirement with acceptance criteria; preserves every other requirement and slot.",
        inputSchema: {
            spec_id: z.string(),
            expected_version: expectedVersionSchema,
            requirement: requirementSchema,
        },
    }, async ({ spec_id, expected_version, requirement }) => {
        try {
            return ok(`Saved requirement ${requirement.req_key}.`, {
                spec: await ctx.api.agentJSON("PUT", specPath(spec_id, `/requirements/${encodeURIComponent(requirement.req_key)}`), {
                    expected_version,
                    ...requirement,
                }),
            });
        }
        catch (e) {
            return fail(String(e));
        }
    });
    server.registerTool("yaaif_agent_spec_delete_requirement", {
        description: "Delete one unreferenced requirement. Remove it from its slots first.",
        inputSchema: {
            spec_id: z.string(),
            expected_version: expectedVersionSchema,
            req_key: z.string(),
        },
    }, async ({ spec_id, expected_version, req_key }) => {
        try {
            return ok(`Deleted requirement ${req_key}.`, {
                spec: await ctx.api.agentJSON("DELETE", `${specPath(spec_id, `/requirements/${encodeURIComponent(req_key)}`)}?expected_version=${expected_version}`),
            });
        }
        catch (e) {
            return fail(String(e));
        }
    });
    server.registerTool("yaaif_agent_spec_upsert_slot", {
        description: "Create or update one architecture slot and its requirement links without replacing the slot list.",
        inputSchema: {
            spec_id: z.string(),
            expected_version: expectedVersionSchema,
            slot: slotSchema,
        },
    }, async ({ spec_id, expected_version, slot }) => {
        try {
            return ok(`Saved slot ${slot.slot_key}.`, {
                spec: await ctx.api.agentJSON("PUT", specPath(spec_id, `/slots/${encodeURIComponent(slot.slot_key)}`), {
                    expected_version,
                    ...slot,
                }),
            });
        }
        catch (e) {
            return fail(String(e));
        }
    });
    server.registerTool("yaaif_agent_spec_delete_slot", {
        description: "Delete one unbound architecture slot.",
        inputSchema: {
            spec_id: z.string(),
            expected_version: expectedVersionSchema,
            slot_key: z.string(),
        },
    }, async ({ spec_id, expected_version, slot_key }) => {
        try {
            return ok(`Deleted slot ${slot_key}.`, {
                spec: await ctx.api.agentJSON("DELETE", `${specPath(spec_id, `/slots/${encodeURIComponent(slot_key)}`)}?expected_version=${expected_version}`),
            });
        }
        catch (e) {
            return fail(String(e));
        }
    });
    server.registerTool("yaaif_agent_spec_sync_preview", {
        description: "Preview apply (to_objects: spec → catalog) or adopt (from_objects: catalog → spec). Read-only; must precede sync apply.",
        inputSchema: {
            spec_id: z.string(),
            direction: z.enum(["from_objects", "to_objects"]),
        },
    }, async ({ spec_id, direction }) => {
        try {
            return ok("Prepared Scenario sync preview.", {
                preview: await ctx.api.agentJSON("GET", `${specPath(spec_id, "/sync-preview")}?direction=${direction}`),
            });
        }
        catch (e) {
            return fail(String(e));
        }
    });
    server.registerTool("yaaif_agent_spec_sync_apply", {
        description: "Apply a reviewed preview: to_objects writes the Scenario onto bound catalog objects; from_objects adopts live catalog drift into the Scenario.",
        inputSchema: {
            spec_id: z.string(),
            expected_version: expectedVersionSchema,
            direction: z.enum(["from_objects", "to_objects"]),
            preview_id: z.string().uuid(),
        },
    }, async ({ spec_id, expected_version, direction, preview_id }) => {
        try {
            return ok("Applied Scenario sync.", {
                sync: await ctx.api.agentJSON("POST", specPath(spec_id, "/sync-apply"), { expected_version, direction, preview_id }),
            });
        }
        catch (e) {
            return fail(String(e));
        }
    });
    server.registerTool("yaaif_agent_spec_conflicts", {
        description: "List unresolved field-level Scenario/catalog conflicts, including severity and the two competing values.",
        inputSchema: { spec_id: z.string() },
    }, async ({ spec_id }) => {
        try {
            return ok("Fetched Scenario conflicts.", {
                conflicts: await ctx.api.agentJSON("GET", specPath(spec_id, "/conflicts")),
            });
        }
        catch (e) {
            return fail(String(e));
        }
    });
    server.registerTool("yaaif_agent_spec_conflict_resolve", {
        description: "Resolve one conflict: accept_object copies the live field into the Scenario, keep_spec retains the Scenario value, and merge sets merged_value.",
        inputSchema: {
            spec_id: z.string(),
            conflict_id: z.string(),
            expected_version: expectedVersionSchema,
            resolution: z.enum(["accept_object", "keep_spec", "merge"]),
            merged_value: z.string().optional(),
        },
    }, async ({ spec_id, conflict_id, expected_version, resolution, merged_value, }) => {
        try {
            return ok("Resolved Scenario conflict.", {
                spec: await ctx.api.agentJSON("POST", specPath(spec_id, `/conflicts/${encodeURIComponent(conflict_id)}/resolve`), { expected_version, resolution, merged_value: merged_value ?? "" }),
            });
        }
        catch (e) {
            return fail(String(e));
        }
    });
    server.registerTool("yaaif_agent_spec_evidence_record", {
        description: "Record requirement-level verification evidence from a passed agent test, ambient smoke run, or audited manual attestation.",
        inputSchema: {
            spec_id: z.string(),
            expected_version: expectedVersionSchema,
            requirement_key: z.string(),
            kind: z.enum(["agent_test_run", "ambient_run", "manual_attestation"]),
            result: z.enum(["passed", "failed"]),
            source_id: z.string().optional(),
            summary: z.string().optional(),
            payload: z.record(z.unknown()).optional(),
            expires_at: z.string().datetime().optional(),
            provenance_uri: z.string().url().optional(),
            idempotency_key: z.string().min(8).max(128).optional(),
        },
    }, async (args) => {
        try {
            return ok(`Recorded ${args.result} evidence for ${args.requirement_key}.`, {
                evidence: await ctx.api.agentJSON("POST", specPath(args.spec_id, "/evidence"), args),
            });
        }
        catch (e) {
            return fail(String(e));
        }
    });
    server.registerTool("yaaif_agent_spec_transition", {
        description: "Transition a Scenario lifecycle state. Active is rejected until readiness passes; use a separately authorized override only for exceptional cases.",
        inputSchema: {
            spec_id: z.string(),
            expected_version: expectedVersionSchema,
            status: z.enum([
                "draft",
                "approved",
                "implementing",
                "active",
                "archived",
            ]),
        },
    }, async ({ spec_id, expected_version, status }) => {
        try {
            return ok(`Transitioned Scenario to ${status}.`, {
                spec: await ctx.api.agentJSON("POST", specPath(spec_id, "/transitions"), { expected_version, status }),
            });
        }
        catch (e) {
            return fail(String(e));
        }
    });
    server.registerTool("yaaif_agent_spec_activation_override", {
        description: "Exceptional activation only. Requires the dedicated permission and a durable reason recorded in the Scenario audit log.",
        inputSchema: {
            spec_id: z.string(),
            expected_version: expectedVersionSchema,
            override_reason: z.string().min(1),
            override_approver: z.string().min(1).optional(),
            idempotency_key: z.string().min(8).max(128).optional(),
        },
    }, async ({ spec_id, expected_version, override_reason, override_approver, idempotency_key, }) => {
        try {
            return ok("Activated Scenario with audited override.", {
                spec: await ctx.api.agentJSON("POST", specPath(spec_id, "/activation-override"), {
                    expected_version,
                    override_reason,
                    override_approver: override_approver ?? "",
                    idempotency_key: idempotency_key ?? "",
                }),
            });
        }
        catch (e) {
            return fail(String(e));
        }
    });
    server.registerTool("yaaif_agent_spec_adoption_preview", {
        description: "Preview the selected existing bindings, their current live baseline, and authored fields preserved by adoption.",
        inputSchema: { spec_id: z.string() },
    }, async ({ spec_id }) => {
        try {
            return ok("Prepared Scenario adoption preview.", {
                preview: await ctx.api.agentJSON("GET", specPath(spec_id, "/adoption-preview")),
            });
        }
        catch (e) {
            return fail(String(e));
        }
    });
    server.registerTool("yaaif_agent_spec_coverage", {
        description: "Check Scenario slot coverage against the live tenant catalog.",
        inputSchema: { spec_id: z.string() },
    }, async ({ spec_id }) => {
        try {
            return ok("Fetched scenario coverage.", {
                coverage: await ctx.api.agentJSON("GET", specPath(spec_id, "/coverage")),
            });
        }
        catch (e) {
            return fail(String(e));
        }
    });
    server.registerTool("yaaif_agent_spec_processing", {
        description: "Get Scenario processing / lifecycle status (revisions, sync, attribution).",
        inputSchema: { spec_id: z.string() },
    }, async ({ spec_id }) => {
        try {
            return ok("Fetched scenario processing.", {
                processing: await ctx.api.agentJSON("GET", specPath(spec_id, "/processing")),
            });
        }
        catch (e) {
            return fail(String(e));
        }
    });
    server.registerTool("yaaif_agent_spec_metrics", {
        description: "Query telemetry metrics attributed to a Scenario (sessions, tokens, tools).",
        inputSchema: {
            spec_id: z.string(),
            hours: z.number().optional(),
        },
    }, async ({ spec_id, hours }) => {
        const params = new URLSearchParams();
        if (hours)
            params.set("hours", String(hours));
        const suffix = params.size ? `?${params}` : "";
        try {
            return ok("Fetched scenario metrics.", {
                metrics: await ctx.api.apiJSON("GET", `/api/metrics/agent-specs/${encodeURIComponent(spec_id)}${suffix}`),
            });
        }
        catch (e) {
            return fail(String(e));
        }
    });
}
