import { z } from "zod";
import { IssuerMismatchError, ReauthRequiredError } from "../auth/oidc.js";
import { applyProfileToConfig, inferProfileId, } from "../platform/profiles.js";
import { normalizeTenants, parseLastTenantId, parseTenantMemberships, resolveTenant, } from "../platform/tenants.js";
import { fail, ok } from "./helpers.js";
async function probeOidc(authority) {
    const url = `${authority.replace(/\/+$/, "")}/.well-known/openid-configuration`;
    const res = await fetch(url);
    const text = await res.text();
    if (!res.ok)
        throw new Error(`OIDC discovery failed (${res.status}): ${text.slice(0, 200)}`);
    const doc = JSON.parse(text);
    const issuer = typeof doc.issuer === "string" ? doc.issuer.replace(/\/+$/, "") : "";
    const expected = authority.replace(/\/+$/, "");
    return {
        discovery_url: url,
        issuer,
        issuer_matches_authority: issuer.toLowerCase() === expected.toLowerCase(),
        authorization_endpoint: doc.authorization_endpoint,
        token_endpoint: doc.token_endpoint,
    };
}
async function loadMemberships(ctx) {
    const raw = await ctx.api.apiJSON("GET", "/api/users/me/tenants");
    return parseTenantMemberships(raw);
}
async function loadLastTenantId(ctx) {
    try {
        const view = await ctx.api.apiJSON("GET", "/api/users/me/last-tenant");
        return parseLastTenantId(view);
    }
    catch {
        return "";
    }
}
async function activateTenant(ctx, tenantId, tenantName) {
    const sess = await ctx.auth.setTenant(tenantId, tenantName);
    const activated = await ctx.api.apiJSON("POST", "/api/users/me/active-tenant", {
        tenant_id: tenantId,
    });
    return { sess, activated };
}
async function resolveAndSetTenant(ctx, query) {
    const memberships = await loadMemberships(ctx);
    const resolved = resolveTenant(memberships, query);
    if ("error" in resolved) {
        return { ok: false, ...resolved, memberships };
    }
    const { sess, activated } = await activateTenant(ctx, resolved.tenant.tenant_id, resolved.tenant.tenant_name);
    return {
        ok: true,
        tenant: resolved.tenant,
        session: sess,
        activated,
        memberships,
    };
}
async function autoSelectTenant(ctx) {
    const memberships = await loadMemberships(ctx);
    const lastId = await loadLastTenantId(ctx);
    const defaultId = (ctx.cfg.defaultTenantId || "").trim();
    const selected = (await ctx.auth.session())?.tenant_id?.trim() || "";
    let pick = "";
    let reason = "";
    if (selected && memberships.some((m) => m.tenant_id === selected)) {
        pick = selected;
        reason = "session";
    }
    else if (defaultId && memberships.some((m) => m.tenant_id === defaultId)) {
        pick = defaultId;
        reason = "default";
    }
    else if (lastId && memberships.some((m) => m.tenant_id === lastId)) {
        pick = lastId;
        reason = "last_tenant";
    }
    else if (memberships.length === 1) {
        pick = memberships[0].tenant_id;
        reason = "single_membership";
    }
    if (!pick) {
        return {
            selected: false,
            needs_tenant_selection: true,
            tenants: normalizeTenants(memberships, { lastTenantId: lastId, selectedTenantId: selected }),
            last_tenant_id: lastId,
        };
    }
    const member = memberships.find((m) => m.tenant_id === pick);
    const { sess, activated } = await activateTenant(ctx, member.tenant_id, member.tenant_name);
    return {
        selected: true,
        needs_tenant_selection: false,
        reason,
        tenant_id: member.tenant_id,
        tenant_name: member.tenant_name,
        tenants: normalizeTenants(memberships, {
            lastTenantId: lastId,
            selectedTenantId: member.tenant_id,
        }),
        session: sess,
        activated,
    };
}
function errPayload(e) {
    if (e instanceof ReauthRequiredError) {
        return fail(e.message, { code: e.code, reauth_required: true });
    }
    if (e instanceof IssuerMismatchError) {
        return fail(e.message, {
            code: e.code,
            reauth_required: true,
            session_authority: e.sessionAuthority,
            config_authority: e.configAuthority,
        });
    }
    return fail(String(e));
}
export function registerAuthTools(server, ctx) {
    server.registerTool("yaaif_platform_list", {
        description: "List builtin and custom YAAIF platform profiles (hosted, local-hybrid, local, …).",
        inputSchema: {},
    }, async () => {
        const active = await ctx.profiles.getActive();
        const profiles = await ctx.profiles.listAll();
        return ok("Listed platform profiles.", {
            active_profile_id: active?.profile_id || ctx.cfg.activeProfileId || inferProfileId(ctx.cfg),
            inferred_profile_id: inferProfileId(ctx.cfg),
            profiles,
            current: {
                oidc_authority: ctx.cfg.oidcAuthority,
                api_base: ctx.cfg.apiBaseUrl,
                agent_base: ctx.cfg.agentBaseUrl,
                control_plane_base: ctx.cfg.controlPlaneBaseUrl,
                approval_base: ctx.cfg.approvalBaseUrl,
            },
        });
    });
    server.registerTool("yaaif_platform_use", {
        description: "Switch active platform profile (hosted | local-hybrid | local | custom id). Clears session if OIDC issuer changes.",
        inputSchema: {
            profile_id: z.string(),
            clear_session_on_issuer_change: z.boolean().optional(),
        },
    }, async ({ profile_id, clear_session_on_issuer_change }) => {
        try {
            const profile = await ctx.profiles.get(profile_id);
            if (!profile)
                return fail(`unknown profile: ${profile_id}`);
            const prevIssuer = ctx.cfg.oidcAuthority;
            await ctx.profiles.setActive(profile.id);
            applyProfileToConfig(ctx.cfg, profile);
            const issuerChanged = prevIssuer.replace(/\/+$/, "").toLowerCase()
                !== profile.oidc_authority.replace(/\/+$/, "").toLowerCase();
            let session_cleared = false;
            if (issuerChanged && (clear_session_on_issuer_change ?? true)) {
                await ctx.auth.logout({ endSession: false });
                session_cleared = true;
            }
            return ok(`Active platform profile set to ${profile.id}.`, {
                profile,
                session_cleared,
                issuer_changed: issuerChanged,
                note: session_cleared
                    ? "Session cleared due to OIDC issuer change — call yaaif_login or yaaif_ensure_session."
                    : undefined,
            });
        }
        catch (e) {
            return fail(String(e));
        }
    });
    server.registerTool("yaaif_platform_save", {
        description: "Save or update a custom platform profile under ~/.yaaif/cursor/profiles.json.",
        inputSchema: {
            id: z.string(),
            label: z.string().optional(),
            description: z.string().optional(),
            oidc_authority: z.string(),
            api_base_url: z.string(),
            agent_base_url: z.string().optional(),
            control_plane_base_url: z.string().optional(),
            approval_base_url: z.string().optional(),
            oidc_client_id: z.string().optional(),
            activate: z.boolean().optional(),
        },
    }, async (args) => {
        try {
            const profile = await ctx.profiles.upsertCustom({
                id: args.id,
                label: args.label || args.id,
                description: args.description,
                oidc_authority: args.oidc_authority,
                api_base_url: args.api_base_url,
                agent_base_url: args.agent_base_url || "",
                control_plane_base_url: args.control_plane_base_url || "",
                approval_base_url: args.approval_base_url || "",
                oidc_client_id: args.oidc_client_id,
            });
            if (args.activate) {
                await ctx.profiles.setActive(profile.id);
                applyProfileToConfig(ctx.cfg, profile);
            }
            return ok(`Saved custom profile ${profile.id}.`, { profile, activated: Boolean(args.activate) });
        }
        catch (e) {
            return fail(String(e));
        }
    });
    server.registerTool("yaaif_configure_check", {
        description: "Validate platform profile, OIDC discovery, auth session, and service reachability.",
        inputSchema: {},
    }, async () => {
        const sess = await ctx.auth.session();
        const out = {
            profile_id: ctx.cfg.activeProfileId || inferProfileId(ctx.cfg),
            oidc_authority: ctx.cfg.oidcAuthority,
            api_base: ctx.cfg.apiBaseUrl,
            agent_base: ctx.cfg.agentBaseUrl,
            control_plane_base: ctx.cfg.controlPlaneBaseUrl,
            approval_base: ctx.cfg.approvalBaseUrl,
            client_id: ctx.cfg.oidcClientId,
            authenticated: Boolean(sess?.tokens.access_token),
            tenant_id: sess?.tenant_id || ctx.cfg.defaultTenantId || "",
            tenant_name: sess?.tenant_name || "",
            session_profile_id: sess?.profile_id || "",
            session_oidc_authority: sess?.oidc_authority || "",
        };
        try {
            out.oidc = await probeOidc(ctx.cfg.oidcAuthority);
        }
        catch (e) {
            out.oidc_error = String(e);
        }
        try {
            ctx.auth.assertIssuerMatch(sess);
            out.issuer_match = true;
        }
        catch (e) {
            out.issuer_match = false;
            out.issuer_error = String(e);
        }
        const probe = async (key, url) => {
            try {
                out[key] = (await fetch(url)).status;
            }
            catch (e) {
                out[`${key}_error`] = String(e);
            }
        };
        await Promise.all([
            probe("api_health", `${ctx.cfg.apiBaseUrl}/health`),
            probe("agent_health", `${ctx.cfg.agentBaseUrl}/health`),
            probe("control_plane_health", `${ctx.cfg.controlPlaneBaseUrl}/health`),
            probe("approval_health", `${ctx.cfg.approvalBaseUrl}/health`),
        ]);
        if (sess?.tokens.access_token && out.issuer_match !== false) {
            try {
                out.rbac_me = await ctx.api.apiJSON("GET", "/api/rbac/me");
            }
            catch (e) {
                out.rbac_error = String(e);
            }
        }
        return ok("Configuration check complete.", out);
    });
    server.registerTool("yaaif_login", {
        description: "Open browser PKCE login against the active platform OIDC authority and persist tokens.",
        inputSchema: {},
    }, async () => {
        try {
            const { session, auth_url } = await ctx.auth.login();
            let tenant;
            try {
                tenant = await autoSelectTenant(ctx);
            }
            catch (e) {
                tenant = { auto_select_error: String(e) };
            }
            return ok("Logged in to YAAIF.", {
                email: session.email,
                name: session.name,
                subject: session.subject,
                tenant_id: (await ctx.auth.session())?.tenant_id || session.tenant_id,
                tenant_name: (await ctx.auth.session())?.tenant_name,
                profile_id: session.profile_id,
                oidc_authority: session.oidc_authority,
                expires: session.tokens.expiry,
                auth_url,
                tenant_selection: tenant,
            });
        }
        catch (e) {
            return fail(String(e));
        }
    });
    server.registerTool("yaaif_logout", {
        description: "Clear the local YAAIF Cursor session. Optionally open Keycloak end_session.",
        inputSchema: { end_session: z.boolean().optional() },
    }, async ({ end_session }) => {
        const result = await ctx.auth.logout({ endSession: Boolean(end_session) });
        return ok("Logged out.", result);
    });
    server.registerTool("yaaif_whoami", {
        description: "Return current profile, auth session, tenant name/id, and RBAC identity.",
        inputSchema: {},
    }, async () => {
        const sess = await ctx.auth.session();
        if (!sess?.tokens.access_token) {
            return ok("Not authenticated.", {
                authenticated: false,
                profile_id: ctx.cfg.activeProfileId || inferProfileId(ctx.cfg),
                oidc_authority: ctx.cfg.oidcAuthority,
                api_base: ctx.cfg.apiBaseUrl,
            });
        }
        try {
            ctx.auth.assertIssuerMatch(sess);
        }
        catch (e) {
            return errPayload(e);
        }
        let me;
        let tenantsNorm;
        try {
            me = await ctx.api.apiJSON("GET", "/api/rbac/me");
        }
        catch { /* optional */ }
        try {
            const memberships = await loadMemberships(ctx);
            const lastId = await loadLastTenantId(ctx);
            tenantsNorm = normalizeTenants(memberships, {
                selectedTenantId: sess.tenant_id,
                lastTenantId: lastId,
            });
        }
        catch { /* optional */ }
        const selected = Array.isArray(tenantsNorm)
            ? tenantsNorm.find((t) => t.is_selected)
            : undefined;
        return ok("Authenticated YAAIF session.", {
            authenticated: true,
            email: sess.email,
            name: sess.name,
            subject: sess.subject,
            tenant_id: sess.tenant_id || ctx.cfg.defaultTenantId || "",
            tenant_name: sess.tenant_name || selected?.name || "",
            profile_id: ctx.cfg.activeProfileId || sess.profile_id || inferProfileId(ctx.cfg),
            session_profile_id: sess.profile_id,
            oidc_authority: ctx.cfg.oidcAuthority,
            session_oidc_authority: sess.oidc_authority,
            expires: sess.tokens.expiry,
            rbac_me: me,
            tenants: tenantsNorm,
            api_base: ctx.cfg.apiBaseUrl,
            agent_base: ctx.cfg.agentBaseUrl,
            control_plane_base: ctx.cfg.controlPlaneBaseUrl,
            approval_base: ctx.cfg.approvalBaseUrl,
        });
    });
    server.registerTool("yaaif_list_tenants", {
        description: "List tenants for the signed-in user (normalized: id, name, slug, is_last, is_selected).",
        inputSchema: {},
    }, async () => {
        try {
            const memberships = await loadMemberships(ctx);
            const lastId = await loadLastTenantId(ctx);
            const selected = (await ctx.auth.session())?.tenant_id;
            return ok("Listed tenants.", {
                tenants: normalizeTenants(memberships, { lastTenantId: lastId, selectedTenantId: selected }),
                last_tenant_id: lastId,
                selected_tenant_id: selected || "",
            });
        }
        catch (e) {
            return errPayload(e);
        }
    });
    server.registerTool("yaaif_set_tenant", {
        description: "Set active tenant by UUID, name, or slug; activates on the server.",
        inputSchema: {
            tenant: z.string().optional(),
            tenant_id: z.string().optional(),
        },
    }, async ({ tenant, tenant_id }) => {
        const query = (tenant || tenant_id || "").trim();
        if (!query)
            return fail("tenant or tenant_id is required");
        try {
            const result = await resolveAndSetTenant(ctx, query);
            if (!result.ok) {
                return fail(result.error, {
                    candidates: result.candidates,
                    tenants: normalizeTenants(result.memberships),
                });
            }
            return ok(`Active tenant set to ${result.tenant.tenant_name} (${result.tenant.tenant_id}).`, {
                tenant_id: result.tenant.tenant_id,
                tenant_name: result.tenant.tenant_name,
                email: result.session.email,
                activated: result.activated,
                tenants: normalizeTenants(result.memberships, {
                    selectedTenantId: result.tenant.tenant_id,
                }),
            });
        }
        catch (e) {
            return errPayload(e);
        }
    });
    server.registerTool("yaaif_ensure_session", {
        description: "One-shot: validate platform/OIDC, refresh or login, auto-select tenant (last/single/default), return ready state.",
        inputSchema: {
            login_if_needed: z.boolean().optional(),
            tenant: z.string().optional(),
            profile_id: z.string().optional(),
        },
    }, async ({ login_if_needed, tenant, profile_id }) => {
        try {
            if (profile_id) {
                const profile = await ctx.profiles.get(profile_id);
                if (!profile)
                    return fail(`unknown profile: ${profile_id}`);
                await ctx.profiles.setActive(profile.id);
                applyProfileToConfig(ctx.cfg, profile);
            }
            let oidc;
            try {
                oidc = await probeOidc(ctx.cfg.oidcAuthority);
            }
            catch (e) {
                return fail(`OIDC discovery failed for ${ctx.cfg.oidcAuthority}: ${String(e)}`, {
                    profile_id: ctx.cfg.activeProfileId,
                    oidc_authority: ctx.cfg.oidcAuthority,
                });
            }
            let sess = await ctx.auth.session();
            try {
                ctx.auth.assertIssuerMatch(sess);
            }
            catch (e) {
                if (login_if_needed) {
                    await ctx.auth.logout({ endSession: false });
                    sess = null;
                }
                else {
                    return errPayload(e);
                }
            }
            let logged_in = false;
            let auth_url;
            if (!sess?.tokens.access_token) {
                if (!login_if_needed) {
                    return ok("Session not ready — login required.", {
                        ready: false,
                        reauth_required: true,
                        profile_id: ctx.cfg.activeProfileId || inferProfileId(ctx.cfg),
                        oidc,
                    });
                }
                const login = await ctx.auth.login();
                logged_in = true;
                auth_url = login.auth_url;
                sess = login.session;
            }
            else {
                try {
                    await ctx.auth.accessToken();
                }
                catch (e) {
                    if (login_if_needed) {
                        const login = await ctx.auth.login();
                        logged_in = true;
                        auth_url = login.auth_url;
                        sess = login.session;
                    }
                    else {
                        return errPayload(e);
                    }
                }
            }
            if (tenant) {
                const set = await resolveAndSetTenant(ctx, tenant);
                if (!set.ok) {
                    return fail(set.error, { ready: false, candidates: set.candidates, oidc });
                }
                return ok("Session ready.", {
                    ready: true,
                    logged_in,
                    auth_url,
                    profile_id: ctx.cfg.activeProfileId || inferProfileId(ctx.cfg),
                    oidc_authority: ctx.cfg.oidcAuthority,
                    api_base: ctx.cfg.apiBaseUrl,
                    email: set.session.email,
                    tenant_id: set.tenant.tenant_id,
                    tenant_name: set.tenant.tenant_name,
                    tenant_reason: "explicit",
                    tenants: normalizeTenants(set.memberships, { selectedTenantId: set.tenant.tenant_id }),
                    oidc,
                });
            }
            const auto = await autoSelectTenant(ctx);
            if (!auto.selected) {
                return ok("Authenticated but tenant selection required.", {
                    ready: false,
                    needs_tenant_selection: true,
                    logged_in,
                    auth_url,
                    profile_id: ctx.cfg.activeProfileId || inferProfileId(ctx.cfg),
                    oidc_authority: ctx.cfg.oidcAuthority,
                    tenants: auto.tenants,
                    last_tenant_id: auto.last_tenant_id,
                    oidc,
                    hint: "Call yaaif_set_tenant with a tenant name, slug, or uuid.",
                });
            }
            return ok("Session ready.", {
                ready: true,
                logged_in,
                auth_url,
                profile_id: ctx.cfg.activeProfileId || inferProfileId(ctx.cfg),
                oidc_authority: ctx.cfg.oidcAuthority,
                api_base: ctx.cfg.apiBaseUrl,
                email: auto.session?.email,
                tenant_id: auto.tenant_id,
                tenant_name: auto.tenant_name,
                tenant_reason: auto.reason,
                tenants: auto.tenants,
                oidc,
            });
        }
        catch (e) {
            return errPayload(e);
        }
    });
}
