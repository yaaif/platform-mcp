import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { resolveDocsBaseUrl } from "../config.js";
function trimSlash(v) {
    return v.replace(/\/+$/, "");
}
export function deriveServiceUrls(apiBase) {
    const base = trimSlash(apiBase);
    return {
        api_base_url: base,
        agent_base_url: `${base}/agent-service`,
        control_plane_base_url: `${base}/control-plane-service`,
        approval_base_url: `${base}/approval-service`,
    };
}
const OIDC_PATH = /\/auth\/realms\/[^/]+\/?$/i;
export const HOSTED_PLATFORM_URL = "https://platform.yaaif.ai";
export const LOCAL_PLATFORM_URL = "https://platform.yaaif.local";
export function normalizePlatformUrl(raw) {
    let s = raw.trim();
    if (!s)
        throw new Error("YAAIF URL is empty");
    if (!/^https?:\/\//i.test(s))
        s = `https://${s}`;
    let parsed;
    try {
        parsed = new URL(s);
    }
    catch {
        throw new Error(`invalid YAAIF URL: ${raw}`);
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        throw new Error(`YAAIF URL must be http(s) (got ${parsed.protocol})`);
    }
    parsed.hash = "";
    parsed.search = "";
    parsed.pathname = parsed.pathname.replace(OIDC_PATH, "");
    if (parsed.pathname === "/")
        parsed.pathname = "";
    return trimSlash(parsed.toString());
}
export function profileIdFromHostname(hostname) {
    const slug = hostname
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
    const id = slug || "custom";
    if (id === "hosted" || id === "local" || id === "local-hybrid")
        return `custom-${id}`;
    if (/^[0-9]/.test(id))
        return `p-${id}`;
    return id;
}
/** Map a platform base (or OIDC) URL to hosted, local, or a custom profile. */
export function profileFromPlatformUrl(raw, oidcClientId = "yaaif-cursor") {
    const api = normalizePlatformUrl(raw);
    const host = new URL(api).hostname.toLowerCase();
    const builtins = builtinProfiles(oidcClientId);
    if (host === "platform.yaaif.ai")
        return builtins.find((p) => p.id === "hosted");
    if (host === "platform.yaaif.local")
        return builtins.find((p) => p.id === "local");
    return {
        id: profileIdFromHostname(host),
        label: api,
        description: `Custom YAA\\F at ${api}`,
        builtin: false,
        oidc_authority: `${api}/auth/realms/yaaif`,
        ...deriveServiceUrls(api),
        oidc_client_id: oidcClientId,
    };
}
export function builtinProfiles(oidcClientId = "yaaif-cursor") {
    return [
        {
            id: "hosted",
            label: "Hosted (platform.yaaif.ai)",
            description: "Production / hosted YAA\\F — OIDC and APIs on platform.yaaif.ai",
            builtin: true,
            oidc_authority: "https://platform.yaaif.ai/auth/realms/yaaif",
            ...deriveServiceUrls("https://platform.yaaif.ai"),
            oidc_client_id: oidcClientId,
        },
        {
            id: "local-hybrid",
            label: "Local hybrid (OIDC .com + APIs .local)",
            description: "Local Traefik APIs on platform.yaaif.local with Keycloak issuer platform.yaaif.com (tunnel)",
            builtin: true,
            oidc_authority: "https://platform.yaaif.com/auth/realms/yaaif",
            ...deriveServiceUrls("https://platform.yaaif.local"),
            oidc_client_id: oidcClientId,
        },
        {
            id: "local",
            label: "Local (all .local)",
            description: "OIDC and APIs on platform.yaaif.local",
            builtin: true,
            oidc_authority: "https://platform.yaaif.local/auth/realms/yaaif",
            ...deriveServiceUrls("https://platform.yaaif.local"),
            oidc_client_id: oidcClientId,
        },
    ];
}
export const BUILTIN_PROFILES = builtinProfiles();
/** A tool tried to switch away from the platform the installation fixed. */
export class PlatformLockedError extends Error {
    locked;
    code = "platform_locked";
    constructor(locked, attempted) {
        super(`This workspace is bound to ${locked.api_base_url} (profile ${locked.id}) by its installation; ` +
            `'${attempted}' cannot be used here and no platform setup is needed. ` +
            "Call yaaif_ensure_session to check the sign-in, and yaaif_login_device if it reports login required.");
        this.locked = locked;
        this.name = "PlatformLockedError";
    }
}
export class ProfileStore {
    stateHome;
    defaultOidcClientId;
    customPath;
    activePath;
    /** Set by lock(): the only profile setActive accepts, which tools cannot overwrite. */
    locked = null;
    constructor(stateHome, defaultOidcClientId = "yaaif-cursor") {
        this.stateHome = stateHome;
        this.defaultOidcClientId = defaultOidcClientId;
        this.customPath = join(stateHome, "profiles.json");
        this.activePath = join(stateHome, "active-profile.json");
    }
    async ensureHome() {
        await mkdir(this.stateHome, { recursive: true, mode: 0o700 });
    }
    async listCustom() {
        try {
            const raw = JSON.parse(await readFile(this.customPath, "utf8"));
            return Array.isArray(raw.profiles) ? raw.profiles.filter((p) => p?.id && p.api_base_url) : [];
        }
        catch (err) {
            if (err.code === "ENOENT")
                return [];
            throw err;
        }
    }
    async saveCustom(profiles) {
        await this.ensureHome();
        const tmp = `${this.customPath}.${process.pid}.${randomUUID()}.tmp`;
        await writeFile(tmp, JSON.stringify({ profiles }, null, 2), { mode: 0o600 });
        await rename(tmp, this.customPath);
    }
    get lockedProfile() {
        return this.locked;
    }
    /**
     * Bind this store to the installation's platform: save the profile (custom
     * ones are rewritten from the environment on every start, so an edit cannot
     * stick), make it active, and refuse any other from then on.
     */
    async lock(profile) {
        this.locked = null;
        const saved = profile.builtin ? profile : await this.upsertCustom(profile);
        if ((await this.getActive())?.profile_id !== saved.id)
            await this.setActive(saved.id);
        this.locked = saved;
        return saved;
    }
    async upsertCustom(profile) {
        if (this.locked && profile.id.trim().toLowerCase() === this.locked.id) {
            throw new PlatformLockedError(this.locked, profile.id);
        }
        const id = profile.id.trim().toLowerCase();
        if (!id || builtinProfiles(this.defaultOidcClientId).some((b) => b.id === id)) {
            throw new Error(`profile id '${id}' is reserved or invalid`);
        }
        const cleaned = {
            id,
            label: profile.label || id,
            description: profile.description,
            builtin: false,
            oidc_authority: trimSlash(profile.oidc_authority),
            api_base_url: trimSlash(profile.api_base_url),
            agent_base_url: trimSlash(profile.agent_base_url || `${trimSlash(profile.api_base_url)}/agent-service`),
            control_plane_base_url: trimSlash(profile.control_plane_base_url || `${trimSlash(profile.api_base_url)}/control-plane-service`),
            approval_base_url: trimSlash(profile.approval_base_url || `${trimSlash(profile.api_base_url)}/approval-service`),
            oidc_client_id: profile.oidc_client_id || this.defaultOidcClientId,
            extra_ca_file: profile.extra_ca_file?.trim() || undefined,
            client_cert_file: profile.client_cert_file?.trim() || undefined,
            client_key_file: profile.client_key_file?.trim() || undefined,
        };
        const existing = await this.listCustom();
        const next = [...existing.filter((p) => p.id !== id), cleaned];
        await this.saveCustom(next);
        return cleaned;
    }
    async cloneCustom(sourceId, destinationId, label) {
        const source = await this.get(sourceId);
        if (!source)
            throw new Error(`unknown source profile: ${sourceId}`);
        if (await this.get(destinationId))
            throw new Error(`destination profile already exists: ${destinationId}`);
        return await this.upsertCustom({
            ...source,
            id: destinationId,
            label: label?.trim() || `${source.label} (copy)`,
            builtin: false,
        });
    }
    async deleteCustom(profileId) {
        if (this.locked && profileId.trim().toLowerCase() === this.locked.id)
            throw new PlatformLockedError(this.locked, profileId);
        const id = profileId.trim().toLowerCase();
        const existing = await this.listCustom();
        const next = existing.filter((p) => p.id !== id);
        if (next.length === existing.length)
            return false;
        await this.saveCustom(next);
        return true;
    }
    async listAll() {
        return [...builtinProfiles(this.defaultOidcClientId), ...(await this.listCustom())];
    }
    async get(profileId) {
        const id = profileId.trim().toLowerCase();
        return (await this.listAll()).find((p) => p.id === id) ?? null;
    }
    async getActive() {
        try {
            return JSON.parse(await readFile(this.activePath, "utf8"));
        }
        catch (err) {
            if (err.code === "ENOENT")
                return null;
            throw err;
        }
    }
    async setActive(profileId) {
        if (this.locked && profileId !== this.locked.id)
            throw new PlatformLockedError(this.locked, profileId);
        await this.ensureHome();
        const profile = await this.get(profileId);
        if (!profile)
            throw new Error(`unknown profile: ${profileId}`);
        const state = { profile_id: profile.id, updated_at: new Date().toISOString() };
        // Unique per write: parallel tool calls (platform_use, ensure_session) set it at once.
        const tmp = `${this.activePath}.${process.pid}.${randomUUID()}.tmp`;
        await writeFile(tmp, JSON.stringify(state, null, 2), { mode: 0o600 });
        await rename(tmp, this.activePath);
        return state;
    }
}
export function applyProfileToConfig(cfg, profile) {
    cfg.oidcAuthority = trimSlash(profile.oidc_authority);
    cfg.apiBaseUrl = trimSlash(profile.api_base_url);
    cfg.agentBaseUrl = trimSlash(profile.agent_base_url);
    cfg.controlPlaneBaseUrl = trimSlash(profile.control_plane_base_url);
    cfg.approvalBaseUrl = trimSlash(profile.approval_base_url);
    cfg.docsBaseUrl = resolveDocsBaseUrl(cfg.apiBaseUrl);
    if (profile.oidc_client_id)
        cfg.oidcClientId = profile.oidc_client_id;
    cfg.activeProfileId = profile.id;
    if (profile.extra_ca_file)
        cfg.extraCaFile = profile.extra_ca_file;
    if (profile.client_cert_file)
        cfg.clientCertFile = profile.client_cert_file;
    if (profile.client_key_file)
        cfg.clientKeyFile = profile.client_key_file;
    return cfg;
}
export function inferProfileId(cfg) {
    const api = trimSlash(cfg.apiBaseUrl);
    const oidc = trimSlash(cfg.oidcAuthority);
    for (const p of builtinProfiles(cfg.client.oidcClientId)) {
        if (trimSlash(p.api_base_url) === api && trimSlash(p.oidc_authority) === oidc)
            return p.id;
    }
    return cfg.activeProfileId || "custom-env";
}
export async function applyActiveProfile(cfg, store) {
    const active = await store.getActive();
    if (!active?.profile_id) {
        cfg.activeProfileId = inferProfileId(cfg);
        return null;
    }
    const profile = await store.get(active.profile_id);
    if (!profile) {
        cfg.activeProfileId = inferProfileId(cfg);
        return null;
    }
    applyProfileToConfig(cfg, profile);
    return profile;
}
/**
 * The profile a locked installation runs with, from its environment: a
 * built-in profile when the endpoints match one, else a custom profile named
 * after the API host (or YAAIF_PLATFORM_PROFILE).
 */
export function lockedProfileFromConfig(cfg) {
    const api = trimSlash(cfg.apiBaseUrl);
    const oidc = trimSlash(cfg.oidcAuthority);
    const builtin = builtinProfiles(cfg.oidcClientId).find((p) => trimSlash(p.api_base_url) === api && trimSlash(p.oidc_authority) === oidc
        && trimSlash(p.agent_base_url) === trimSlash(cfg.agentBaseUrl));
    if (builtin)
        return builtin;
    const host = new URL(api).hostname.toLowerCase();
    const id = (cfg.activeProfileId || profileIdFromHostname(host)).trim().toLowerCase();
    return {
        id: builtinProfiles(cfg.oidcClientId).some((p) => p.id === id) ? `custom-${id}` : id,
        label: `${host} (set by this installation)`,
        description: "Platform fixed by the installation that runs this MCP; not editable from tools.",
        builtin: false,
        oidc_authority: oidc,
        api_base_url: api,
        agent_base_url: trimSlash(cfg.agentBaseUrl),
        control_plane_base_url: trimSlash(cfg.controlPlaneBaseUrl),
        approval_base_url: trimSlash(cfg.approvalBaseUrl),
        oidc_client_id: cfg.oidcClientId,
    };
}
