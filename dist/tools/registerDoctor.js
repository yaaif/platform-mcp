import { z } from "zod";
import { yaaifFetch } from "../client/tls.js";
import { inferProfileId } from "../platform/profiles.js";
import { redactSecrets } from "../lib/telemetry.js";
import { fail, ok } from "./helpers.js";
export function registerDoctorTools(server, ctx) {
    server.registerTool("yaaif_doctor", {
        description: "End-to-end health narrative: profile, OIDC discovery, TLS, auth, tenant, catalog ping. Prefer before create/plan work.",
        inputSchema: {
            login_if_needed: z.boolean().optional(),
        },
    }, async ({ login_if_needed }) => {
        const checks = [];
        const add = (name, okFlag, detail) => {
            checks.push({ name, ok: okFlag, detail: detail !== undefined ? redactSecrets(detail) : undefined });
        };
        add("profile", true, {
            profile_id: ctx.cfg.activeProfileId || inferProfileId(ctx.cfg),
            oidc_authority: ctx.cfg.oidcAuthority,
            api_base: ctx.cfg.apiBaseUrl,
            extra_ca_file: ctx.cfg.extraCaFile || null,
            client_cert_file: ctx.cfg.clientCertFile || null,
        });
        try {
            const url = `${ctx.cfg.oidcAuthority}/.well-known/openid-configuration`;
            const res = await yaaifFetch(url);
            const doc = res.ok ? await res.json() : null;
            add("oidc_discovery", res.ok, {
                status: res.status,
                issuer: doc?.issuer,
                device_authorization_endpoint: doc?.device_authorization_endpoint ?? null,
            });
        }
        catch (e) {
            add("oidc_discovery", false, String(e));
        }
        for (const [name, base] of [
            ["api_health", ctx.cfg.apiBaseUrl],
            ["agent_health", ctx.cfg.agentBaseUrl],
            ["control_plane_health", ctx.cfg.controlPlaneBaseUrl],
            ["approval_health", ctx.cfg.approvalBaseUrl],
        ]) {
            try {
                const status = (await yaaifFetch(`${base}/health`)).status;
                add(name, status >= 200 && status < 500, { status, base });
            }
            catch (e) {
                add(name, false, { base, error: String(e) });
            }
        }
        let sessionReady = false;
        try {
            const ensured = await (async () => {
                // Reuse ensure_session logic lightly
                const sess = await ctx.auth.session();
                ctx.auth.assertIssuerMatch(sess);
                if (!sess?.tokens.access_token) {
                    if (!login_if_needed)
                        return { ready: false, reason: "not_authenticated" };
                    await ctx.auth.login();
                }
                else {
                    await ctx.auth.accessToken();
                }
                const who = await ctx.auth.session();
                return {
                    ready: Boolean(who?.tenant_id || ctx.cfg.defaultTenantId),
                    tenant_id: who?.tenant_id || ctx.cfg.defaultTenantId || "",
                    tenant_name: who?.tenant_name || "",
                    email: who?.email,
                };
            })();
            sessionReady = Boolean(ensured.ready);
            add("session", sessionReady, ensured);
            void ctx.telemetry.increment(sessionReady ? "doctor_session_ok" : "doctor_session_incomplete");
        }
        catch (e) {
            add("session", false, String(e));
            void ctx.telemetry.increment("doctor_session_fail");
        }
        if (sessionReady) {
            try {
                const catalog = await ctx.api.agentJSON("GET", "/api/agents?limit=1");
                add("catalog_ping", true, { agents: catalog });
                void ctx.telemetry.increment("doctor_catalog_ok");
            }
            catch (e) {
                add("catalog_ping", false, String(e));
                void ctx.telemetry.increment("doctor_catalog_fail");
            }
            try {
                const localTools = await ctx.api.agentJSON("GET", "/api/local-tools?family=skill");
                add("local_tools", true, {
                    skill_count: localTools.count,
                    total: localTools.total,
                    family_counts: localTools.family_counts,
                });
                void ctx.telemetry.increment("doctor_local_tools_ok");
            }
            catch (e) {
                add("local_tools", false, String(e));
                void ctx.telemetry.increment("doctor_local_tools_fail");
            }
            try {
                const smoke = await ctx.api.agentJSON("POST", "/api/local-tools/list_ambient_workflows/call", { arguments: {}, resolve_workspace: false });
                const okSmoke = smoke?.is_error !== true;
                add("local_tools_smoke", okSmoke, { tool: "list_ambient_workflows", result: smoke });
                void ctx.telemetry.increment(okSmoke ? "doctor_local_tools_smoke_ok" : "doctor_local_tools_smoke_fail");
            }
            catch (e) {
                add("local_tools_smoke", false, String(e));
                void ctx.telemetry.increment("doctor_local_tools_smoke_fail");
            }
            try {
                // Missing seed → 400 means the RO ops route is mounted.
                await ctx.api.agentJSON("GET", "/api/ops/correlate");
                add("ops_api", true, { note: "unexpected 200 without seed" });
                void ctx.telemetry.increment("doctor_ops_api_ok");
            }
            catch (e) {
                const msg = String(e);
                const routeOk = /\b400\b/.test(msg) || /at least one of session_id/i.test(msg);
                add("ops_api", routeOk, { error: msg.slice(0, 240) });
                void ctx.telemetry.increment(routeOk ? "doctor_ops_api_ok" : "doctor_ops_api_fail");
            }
        }
        const failed = checks.filter((c) => !c.ok);
        const summary = failed.length
            ? `Doctor found ${failed.length} issue(s): ${failed.map((f) => f.name).join(", ")}`
            : "Doctor checks passed.";
        return failed.length ? fail(summary, { checks, ready: false }) : ok(summary, { checks, ready: true });
    });
    server.registerTool("yaaif_telemetry_get", {
        description: "Get anonymous local telemetry opt-in state and counters (~/.yaaif/cursor/telemetry.json).",
        inputSchema: {},
    }, async () => {
        const state = await ctx.telemetry.load();
        return ok(state.enabled ? "Telemetry enabled." : "Telemetry disabled.", state);
    });
    server.registerTool("yaaif_telemetry_set", {
        description: "Enable/disable anonymous local success/fail counters (no network, no tokens).",
        inputSchema: { enabled: z.boolean() },
    }, async ({ enabled }) => {
        const state = await ctx.telemetry.setEnabled(enabled);
        return ok(`Telemetry ${enabled ? "enabled" : "disabled"}.`, state);
    });
}
