import { writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { AuthClient } from "../auth/oidc.js";
import { SessionStore } from "../auth/store.js";
import { ApiClient } from "../client/http.js";
import { installTlsDispatcher, yaaifFetch } from "../client/tls.js";
import { loadConfig, parseBridgeClient } from "../config.js";
import { applyProfileToConfig, builtinProfiles, ProfileStore, } from "../platform/profiles.js";
import { parseLastTenantId, parseTenantMemberships } from "../platform/tenants.js";
export const SETUP_ACTIONS = ["detect", "profile", "login", "whoami", "all"];
const BUILTIN_ORDER = ["hosted", "local-hybrid", "local"];
export function parseSetupAction(argv) {
    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        if (arg.startsWith("--setup=")) {
            return requireAction(arg.slice("--setup=".length));
        }
        if (arg === "--setup") {
            return requireAction(argv[i + 1] ?? "");
        }
    }
    return null;
}
export function parseProfileFlag(argv) {
    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        if (arg.startsWith("--profile="))
            return arg.slice("--profile=".length).trim() || undefined;
        if (arg === "--profile" || arg === "--profile-id") {
            const v = (argv[i + 1] ?? "").trim();
            return v && !v.startsWith("-") ? v : undefined;
        }
    }
    return undefined;
}
function requireAction(raw) {
    const v = raw.trim().toLowerCase();
    if (SETUP_ACTIONS.includes(v))
        return v;
    throw new Error(`--setup requires ${SETUP_ACTIONS.join("|")} (got ${raw || "(empty)"})`);
}
export function chooseDetectedProfile(opts) {
    const existing = (opts.existingId || "").trim().toLowerCase();
    if (existing) {
        return { profile_id: existing, kept_existing: true, reason: "existing_active_profile" };
    }
    for (const id of BUILTIN_ORDER) {
        if (opts.reachable[id]) {
            return { profile_id: id, kept_existing: false, reason: `reachable_${id}` };
        }
    }
    return { profile_id: "hosted", kept_existing: false, reason: "default_hosted_unreachable" };
}
export function loginSkippedByEnv(env = process.env) {
    const flag = (name) => (env[name] ?? "").trim() === "1" || (env[name] ?? "").trim().toLowerCase() === "true";
    return flag("YAAIF_INSTALLER_NO_LOGIN") || flag("YAAIF_INSTALLER_NO_OPEN") || flag("CI");
}
async function probeUrl(url, timeoutMs) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
        const res = await yaaifFetch(url, { signal: ac.signal });
        return res.ok;
    }
    catch {
        return false;
    }
    finally {
        clearTimeout(timer);
    }
}
export async function defaultProfileProbe(profileId, timeoutMs = 3500) {
    const profile = builtinProfiles().find((p) => p.id === profileId);
    if (!profile)
        return false;
    const cfg = loadConfig();
    applyProfileToConfig(cfg, profile);
    installTlsDispatcher(cfg);
    const oidcOk = await probeUrl(`${profile.oidc_authority.replace(/\/+$/, "")}/.well-known/openid-configuration`, timeoutMs);
    const healthOk = await probeUrl(`${profile.api_base_url.replace(/\/+$/, "")}/health`, timeoutMs);
    return oidcOk && healthOk;
}
export async function detectDefaultProfile(store, opts = {}) {
    const keepExisting = opts.keepExisting !== false;
    const existing = keepExisting ? await store.getActive() : null;
    if (existing?.profile_id) {
        const known = await store.get(existing.profile_id);
        if (known) {
            return {
                profile_id: known.id,
                kept_existing: true,
                reachable: { hosted: false, "local-hybrid": false, local: false },
                reason: "existing_active_profile",
            };
        }
    }
    const probe = opts.probe ?? defaultProfileProbe;
    const reachable = {
        hosted: false,
        "local-hybrid": false,
        local: false,
    };
    for (const id of BUILTIN_ORDER) {
        reachable[id] = await probe(id);
    }
    const picked = chooseDetectedProfile({ reachable });
    return { ...picked, reachable };
}
export async function writeSetupStatus(stateHome, status) {
    const path = join(stateHome, "setup-status.json");
    const tmp = `${path}.tmp`;
    await writeFile(tmp, JSON.stringify(status, null, 2), { mode: 0o600 });
    await rename(tmp, path);
    return path;
}
function applyKnown(cfg, profile) {
    applyProfileToConfig(cfg, profile);
    installTlsDispatcher(cfg);
}
async function tryRefreshSession(auth) {
    try {
        const sess = await auth.session();
        if (!sess?.tokens.access_token)
            return false;
        auth.assertIssuerMatch(sess);
        await auth.accessToken();
        return true;
    }
    catch {
        return false;
    }
}
async function autoSelectTenant(cfg, auth, api) {
    const memberships = parseTenantMemberships(await api.apiJSON("GET", "/api/users/me/tenants"));
    let lastId = "";
    try {
        lastId = parseLastTenantId(await api.apiJSON("GET", "/api/users/me/last-tenant"));
    }
    catch {
        lastId = "";
    }
    const defaultId = (cfg.defaultTenantId || "").trim();
    const selected = (await auth.session())?.tenant_id?.trim() || "";
    let pick = "";
    if (selected && memberships.some((m) => m.tenant_id === selected))
        pick = selected;
    else if (defaultId && memberships.some((m) => m.tenant_id === defaultId))
        pick = defaultId;
    else if (lastId && memberships.some((m) => m.tenant_id === lastId))
        pick = lastId;
    else if (memberships.length === 1)
        pick = memberships[0].tenant_id;
    if (!pick) {
        return { selected: false, tenants: memberships };
    }
    const member = memberships.find((m) => m.tenant_id === pick);
    await auth.setTenant(member.tenant_id, member.tenant_name);
    try {
        await api.apiJSON("POST", "/api/users/me/active-tenant", { tenant_id: member.tenant_id });
    }
    catch {
        /* activation is best-effort during installer setup */
    }
    return {
        selected: true,
        tenant_id: member.tenant_id,
        tenant_name: member.tenant_name,
        email: (await auth.session())?.email,
    };
}
async function whoamiSnapshot(cfg, auth, api) {
    const sess = await auth.session();
    if (!sess?.tokens.access_token) {
        return {
            login: "required",
            email: undefined,
            tenant_id: undefined,
            tenant_name: undefined,
            needs_tenant_selection: undefined,
            message: "Not signed in.",
        };
    }
    try {
        const auto = await autoSelectTenant(cfg, auth, api);
        if (!auto.selected) {
            return {
                login: "ok",
                email: sess.email,
                tenant_id: undefined,
                tenant_name: undefined,
                needs_tenant_selection: true,
                message: "Signed in; pick a tenant in Cursor with yaaif_set_tenant.",
            };
        }
        return {
            login: "ok",
            email: auto.email || sess.email,
            tenant_id: auto.tenant_id,
            tenant_name: auto.tenant_name,
            message: `Signed in as ${auto.email || sess.email || "unknown"} (${auto.tenant_name || auto.tenant_id}).`,
        };
    }
    catch (e) {
        return {
            login: "ok",
            email: sess.email,
            tenant_id: sess.tenant_id,
            tenant_name: sess.tenant_name,
            needs_tenant_selection: undefined,
            message: `Signed in as ${sess.email || "unknown"} (tenant lookup failed: ${String(e).slice(0, 160)}).`,
        };
    }
}
export async function runInstallerSetup(action, opts = {}) {
    const argv = opts.argv ?? process.argv.slice(2);
    const cfg = loadConfig(parseBridgeClient(argv));
    const store = new SessionStore(cfg.stateHome);
    await store.ensureHome(cfg.stateHome);
    const profiles = new ProfileStore(cfg.stateHome, cfg.client.oidcClientId);
    await profiles.ensureHome();
    const stamp = () => new Date().toISOString();
    const print = (obj) => {
        console.log(JSON.stringify(obj, null, 2));
    };
    const detected = await detectDefaultProfile(profiles, { probe: opts.probe });
    const requested = parseProfileFlag(argv);
    let profileId = requested || detected.profile_id;
    let keptExisting = !requested && detected.kept_existing;
    if (action === "detect") {
        print(detected);
        await writeSetupStatus(cfg.stateHome, {
            profile_id: detected.profile_id,
            kept_existing: detected.kept_existing,
            login: "skipped",
            message: `Detected ${detected.profile_id} (${detected.reason}).`,
            updated_at: stamp(),
        });
        return 0;
    }
    const profile = await profiles.get(profileId);
    if (!profile) {
        console.error(`unknown profile: ${profileId}`);
        return 1;
    }
    if (action === "profile" || action === "all" || action === "login" || action === "whoami") {
        await profiles.setActive(profile.id);
        applyKnown(cfg, profile);
    }
    const auth = new AuthClient(cfg, store);
    const api = new ApiClient(cfg, auth);
    if (action === "profile") {
        const status = {
            profile_id: profile.id,
            kept_existing: keptExisting,
            login: "skipped",
            message: `Active profile is ${profile.id}.`,
            updated_at: stamp(),
        };
        await writeSetupStatus(cfg.stateHome, status);
        print(status);
        return 0;
    }
    let login = "skipped";
    let loginMessage = "";
    if (action === "login" || action === "all") {
        const skipLogin = action === "all" && loginSkippedByEnv();
        if (skipLogin) {
            login = "skipped";
            loginMessage = "Login skipped (silent / CI).";
        }
        else if (await tryRefreshSession(auth)) {
            login = "ok";
            loginMessage = "Existing session is valid.";
        }
        else {
            try {
                console.error(`Opening browser to sign in at ${cfg.oidcAuthority} …`);
                await auth.login();
                login = "ok";
                loginMessage = "Browser sign-in completed.";
            }
            catch (e) {
                login = "failed";
                loginMessage = `Login did not complete: ${String(e).slice(0, 240)}`;
                console.error(loginMessage);
            }
        }
    }
    if (action === "whoami" || action === "all" || action === "login") {
        const snap = login === "failed"
            ? { login, email: undefined, tenant_id: undefined, tenant_name: undefined, needs_tenant_selection: undefined, message: loginMessage }
            : await whoamiSnapshot(cfg, auth, api);
        const status = {
            profile_id: profile.id,
            kept_existing: keptExisting,
            login: snap.login === "required" && login === "skipped" ? "skipped" : snap.login,
            email: snap.email,
            tenant_id: snap.tenant_id,
            tenant_name: snap.tenant_name,
            needs_tenant_selection: snap.needs_tenant_selection,
            message: loginMessage && snap.login !== "ok" ? loginMessage : snap.message,
            updated_at: stamp(),
        };
        if (login === "skipped" && snap.login === "required") {
            status.login = "skipped";
            status.message = loginMessage || "Login skipped; run /yaaif-login in Cursor.";
        }
        if (login === "failed") {
            status.login = "failed";
            status.message = loginMessage;
        }
        await writeSetupStatus(cfg.stateHome, status);
        print(status);
        return 0;
    }
    return 0;
}
