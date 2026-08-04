import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
function trimSlash(v) {
    return v.replace(/\/+$/, "");
}
function deriveServiceUrls(apiBase) {
    const base = trimSlash(apiBase);
    return {
        api_base_url: base,
        agent_base_url: `${base}/agent-service`,
        control_plane_base_url: `${base}/control-plane-service`,
        approval_base_url: `${base}/approval-service`,
    };
}
export const BUILTIN_PROFILES = [
    {
        id: "hosted",
        label: "Hosted (platform.yaaif.ai)",
        description: "Production / hosted YAAIF — OIDC and APIs on platform.yaaif.ai",
        builtin: true,
        oidc_authority: "https://platform.yaaif.ai/auth/realms/yaaif",
        ...deriveServiceUrls("https://platform.yaaif.ai"),
        oidc_client_id: "yaaif-cursor",
    },
    {
        id: "local-hybrid",
        label: "Local hybrid (OIDC .com + APIs .local)",
        description: "Local Traefik APIs on platform.yaaif.local with Keycloak issuer platform.yaaif.com (tunnel)",
        builtin: true,
        oidc_authority: "https://platform.yaaif.com/auth/realms/yaaif",
        ...deriveServiceUrls("https://platform.yaaif.local"),
        oidc_client_id: "yaaif-cursor",
    },
    {
        id: "local",
        label: "Local (all .local)",
        description: "OIDC and APIs on platform.yaaif.local",
        builtin: true,
        oidc_authority: "https://platform.yaaif.local/auth/realms/yaaif",
        ...deriveServiceUrls("https://platform.yaaif.local"),
        oidc_client_id: "yaaif-cursor",
    },
];
export class ProfileStore {
    cursorHome;
    customPath;
    activePath;
    constructor(cursorHome) {
        this.cursorHome = cursorHome;
        this.customPath = join(cursorHome, "profiles.json");
        this.activePath = join(cursorHome, "active-profile.json");
    }
    async ensureHome() {
        await mkdir(this.cursorHome, { recursive: true, mode: 0o700 });
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
        const tmp = `${this.customPath}.tmp`;
        await writeFile(tmp, JSON.stringify({ profiles }, null, 2), { mode: 0o600 });
        await rename(tmp, this.customPath);
    }
    async upsertCustom(profile) {
        const id = profile.id.trim().toLowerCase();
        if (!id || BUILTIN_PROFILES.some((b) => b.id === id)) {
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
            oidc_client_id: profile.oidc_client_id || "yaaif-cursor",
            extra_ca_file: profile.extra_ca_file?.trim() || undefined,
            client_cert_file: profile.client_cert_file?.trim() || undefined,
            client_key_file: profile.client_key_file?.trim() || undefined,
        };
        const existing = await this.listCustom();
        const next = [...existing.filter((p) => p.id !== id), cleaned];
        await this.saveCustom(next);
        return cleaned;
    }
    async deleteCustom(profileId) {
        const id = profileId.trim().toLowerCase();
        const existing = await this.listCustom();
        const next = existing.filter((p) => p.id !== id);
        if (next.length === existing.length)
            return false;
        await this.saveCustom(next);
        return true;
    }
    async listAll() {
        return [...BUILTIN_PROFILES, ...(await this.listCustom())];
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
        await this.ensureHome();
        const profile = await this.get(profileId);
        if (!profile)
            throw new Error(`unknown profile: ${profileId}`);
        const state = { profile_id: profile.id, updated_at: new Date().toISOString() };
        const tmp = `${this.activePath}.tmp`;
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
    for (const p of BUILTIN_PROFILES) {
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
