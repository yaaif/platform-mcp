import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
export const PROFILE_BUNDLE_FORMAT = "yaaif.platform-profiles/v1";
const SECRET_KEY = /token|secret|password|session/i;
function assertSafeValue(value, path = "document") {
    if (!value || typeof value !== "object")
        return;
    for (const [key, nested] of Object.entries(value)) {
        if (SECRET_KEY.test(key))
            throw new Error(`profile bundle contains forbidden field ${path}.${key}`);
        assertSafeValue(nested, `${path}.${key}`);
    }
}
function httpUrl(value, field) {
    const raw = String(value ?? "").trim();
    if (!/^https?:\/\//i.test(raw))
        throw new Error(`profile ${field} must be an http(s) URL`);
    return raw.replace(/\/+$/, "");
}
export function createProfileBundle(profiles, activeProfileId) {
    return {
        format: PROFILE_BUNDLE_FORMAT,
        exported_at: new Date().toISOString(),
        ...(activeProfileId ? { active_profile_id: activeProfileId } : {}),
        profiles: profiles.map((profile) => ({ ...profile })),
    };
}
export function validateProfileBundle(value) {
    if (!value || typeof value !== "object" || Array.isArray(value))
        throw new Error("profile bundle must be an object");
    const bundle = value;
    if (bundle.format !== PROFILE_BUNDLE_FORMAT)
        throw new Error(`unsupported profile bundle format: ${String(bundle.format)}`);
    if (typeof bundle.exported_at !== "string" || !bundle.exported_at)
        throw new Error("profile bundle exported_at is required");
    if (!Array.isArray(bundle.profiles) || bundle.profiles.length > 100)
        throw new Error("profile bundle profiles must be an array with at most 100 entries");
    assertSafeValue(bundle);
    const ids = new Set();
    for (const profile of bundle.profiles) {
        if (!profile || typeof profile !== "object")
            throw new Error("profile entry must be an object");
        const id = String(profile.id ?? "").trim().toLowerCase();
        if (!/^[a-z0-9][a-z0-9._-]*$/.test(id))
            throw new Error(`invalid profile id: ${id}`);
        if (ids.has(id))
            throw new Error(`duplicate profile id: ${id}`);
        ids.add(id);
        profile.id = id;
        profile.label = String(profile.label || id);
        profile.oidc_authority = httpUrl(profile.oidc_authority, "oidc_authority");
        profile.api_base_url = httpUrl(profile.api_base_url, "api_base_url");
        profile.agent_base_url = httpUrl(profile.agent_base_url || `${profile.api_base_url}/agent-service`, "agent_base_url");
        profile.control_plane_base_url = httpUrl(profile.control_plane_base_url || `${profile.api_base_url}/control-plane-service`, "control_plane_base_url");
        profile.approval_base_url = httpUrl(profile.approval_base_url || `${profile.api_base_url}/approval-service`, "approval_base_url");
    }
    if (bundle.active_profile_id && !ids.has(bundle.active_profile_id))
        throw new Error(`active profile ${bundle.active_profile_id} is not present in bundle`);
    return bundle;
}
export async function writeProfileBundle(path, bundle) {
    const validated = validateProfileBundle(bundle);
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const temporary = `${path}.tmp`;
    await writeFile(temporary, `${JSON.stringify(validated, null, 2)}\n`, { mode: 0o600 });
    await rename(temporary, path);
}
export async function readProfileBundle(path) {
    const info = await stat(path);
    if (info.size > 1024 * 1024)
        throw new Error("profile bundle exceeds 1 MiB");
    return validateProfileBundle(JSON.parse(await readFile(path, "utf8")));
}
export async function importProfileBundle(store, bundle, options) {
    const validated = validateProfileBundle(bundle);
    const entries = [];
    for (const profile of validated.profiles) {
        const existing = await store.get(profile.id);
        if (existing?.builtin || profile.builtin)
            entries.push({ id: profile.id, action: "skip_builtin" });
        else if (existing)
            entries.push({ id: profile.id, action: "conflict" });
        else
            entries.push({ id: profile.id, action: "import" });
    }
    const conflicts = entries.filter((entry) => entry.action === "conflict").map((entry) => entry.id);
    const preview = {
        dry_run: options.dryRun,
        entries,
        conflicts,
        import_count: entries.filter((entry) => entry.action === "import").length,
        skipped_builtin_count: entries.filter((entry) => entry.action === "skip_builtin").length,
        activate: options.activate ?? null,
        sessions_copied: false,
    };
    if (options.dryRun)
        return preview;
    if (!options.confirm)
        throw new Error("review the profile import preview first, then rerun with --yes");
    if (conflicts.length)
        throw new Error(`profiles already exist: ${conflicts.join(", ")}`);
    for (const profile of validated.profiles) {
        const action = entries.find((entry) => entry.id === profile.id)?.action;
        if (action === "import")
            await store.upsertCustom(profile);
    }
    if (options.activate)
        await store.setActive(options.activate);
    return { ...preview, imported: true };
}
