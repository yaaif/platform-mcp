import { writeFile, rename } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { stdin as stdIn, stderr as stdErr } from "node:process";
import { join } from "node:path";
import { AuthClient } from "../auth/oidc.js";
import { SessionStore } from "../auth/store.js";
import { ApiClient } from "../client/http.js";
import { installTlsDispatcher, yaaifFetch } from "../client/tls.js";
import { loadConfig, parseBridgeClient } from "../config.js";
import { applyProfileToConfig, builtinProfiles, HOSTED_PLATFORM_URL, profileFromPlatformUrl, ProfileStore, } from "../platform/profiles.js";
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
    return flagValue(argv, "--profile") ?? flagValue(argv, "--profile-id");
}
export function parseYaaifUrl(argv) {
    return flagValue(argv, "--yaaif-url") ?? flagValue(argv, "--platform-url");
}
function flagValue(argv, name) {
    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        if (arg === name) {
            const v = (argv[i + 1] ?? "").trim();
            return v && !v.startsWith("-") ? v : undefined;
        }
        if (arg.startsWith(`${name}=`)) {
            return arg.slice(name.length + 1).trim() || undefined;
        }
    }
    return undefined;
}
export function looksLikePlatformUrl(raw) {
    const s = raw.trim();
    if (!s)
        return false;
    if (/^https?:\/\//i.test(s))
        return true;
    return /^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}([:/].*)?$/i.test(s);
}
export function parsePlatformPromptAnswer(raw, opts) {
    const s = raw.trim();
    if (!s)
        return { action: "invalid" };
    if (looksLikePlatformUrl(s))
        return { action: "url", url: s };
    const lower = s.toLowerCase();
    if (opts.hasExisting) {
        if (lower === "1" || lower === "keep")
            return { action: "keep" };
        if (lower === "2" || lower === "hosted")
            return { action: "hosted" };
        if (lower === "3" || lower === "other" || lower === "url")
            return { action: "other" };
        return { action: "invalid" };
    }
    if (lower === "1" || lower === "hosted")
        return { action: "hosted" };
    if (lower === "2" || lower === "other" || lower === "url")
        return { action: "other" };
    return { action: "invalid" };
}
function isCiEnv(env = process.env) {
    const v = (env.CI ?? "").trim().toLowerCase();
    return v === "1" || v === "true";
}
export function shouldPromptPlatform(action, argv, opts = {}) {
    if (action === "detect" || action === "whoami")
        return false;
    if (parseProfileFlag(argv) || parseYaaifUrl(argv))
        return false;
    if (opts.prompt)
        return true;
    if (opts.interactive === false)
        return false;
    if (opts.interactive === true)
        return true;
    if (isCiEnv(opts.env))
        return false;
    return Boolean(stdIn.isTTY);
}
async function defaultPromptPlatform(input) {
    const rl = createInterface({ input: stdIn, output: stdErr });
    try {
        const hasExisting = Boolean(input.existingId);
        for (;;) {
            if (hasExisting) {
                stdErr.write(`Active YAAIF profile is ${input.existingId} (${input.existingApi || "unknown URL"}).\n` +
                    "  1) Keep current\n" +
                    `  2) Hosted     ${HOSTED_PLATFORM_URL}\n` +
                    "  3) Other URL\n\n" +
                    "Enter 1, 2, 3, or a URL: ");
            }
            else {
                stdErr.write("Which YAAIF platform should this client use?\n" +
                    `  1) Hosted     ${HOSTED_PLATFORM_URL}\n` +
                    "  2) Other URL  (your company YAAIF, or https://platform.yaaif.local)\n\n" +
                    "Enter 1, 2, or a URL: ");
            }
            const first = parsePlatformPromptAnswer(await rl.question(""), { hasExisting });
            if (first.action === "invalid") {
                stdErr.write("Choose hosted, another URL, or keep the current profile.\n");
                continue;
            }
            if (first.action === "other") {
                const url = (await rl.question("YAAIF URL (https://…): ")).trim();
                if (!looksLikePlatformUrl(url)) {
                    stdErr.write("Enter a full host or http(s) URL.\n");
                    continue;
                }
                return { action: "url", url };
            }
            if (first.action === "url")
                return { action: "url", url: first.url };
            if (first.action === "keep")
                return { action: "keep" };
            return { action: "hosted" };
        }
    }
    finally {
        rl.close();
    }
}
async function activateFromUrl(store, rawUrl, oidcClientId) {
    const profile = profileFromPlatformUrl(rawUrl, oidcClientId);
    if (!profile.builtin)
        await store.upsertCustom(profile);
    return profile;
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
export function loginSkippedByEnv(env = process.env, opts = {}) {
    if (opts.noLogin || opts.argv?.includes("--no-login"))
        return true;
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
    const requested = parseProfileFlag(argv);
    const requestedUrl = parseYaaifUrl(argv);
    let profileId;
    let keptExisting = false;
    let detected;
    if (requested) {
        profileId = requested;
    }
    else if (requestedUrl) {
        const fromUrl = await activateFromUrl(profiles, requestedUrl, cfg.client.oidcClientId);
        profileId = fromUrl.id;
    }
    else if (shouldPromptPlatform(action, argv, opts)) {
        const current = await profiles.getActive();
        const existing = current?.profile_id ? await profiles.get(current.profile_id) : null;
        const ask = opts.prompt ?? defaultPromptPlatform;
        const choice = await ask({
            existingId: existing?.id,
            existingApi: existing?.api_base_url,
        });
        if (choice.action === "keep" && existing) {
            profileId = existing.id;
            keptExisting = true;
        }
        else if (choice.action === "url" && choice.url) {
            const fromUrl = await activateFromUrl(profiles, choice.url, cfg.client.oidcClientId);
            profileId = fromUrl.id;
        }
        else {
            profileId = "hosted";
        }
    }
    else {
        detected = await detectDefaultProfile(profiles, { probe: opts.probe });
        profileId = detected.profile_id;
        keptExisting = detected.kept_existing;
    }
    if (action === "detect") {
        const result = detected ?? (await detectDefaultProfile(profiles, { probe: opts.probe }));
        print(result);
        await writeSetupStatus(cfg.stateHome, {
            profile_id: result.profile_id,
            kept_existing: result.kept_existing,
            login: "skipped",
            message: `Detected ${result.profile_id} (${result.reason}).`,
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
        const skipLogin = action === "all" && loginSkippedByEnv(process.env, { noLogin: opts.noLogin, argv });
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
