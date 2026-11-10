import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
function profileDirectory(profileId) {
    const normalized = profileId.trim().toLowerCase();
    if (!normalized)
        throw new Error("profile id is required for profile session storage");
    return normalized.replace(/[^a-z0-9._-]/g, "_");
}
export class SessionStore {
    profileId;
    path;
    constructor(stateHome, profileId) {
        this.profileId = profileId;
        this.path = profileId
            ? join(stateHome, "profile-sessions", profileDirectory(profileId), "session.json")
            : join(stateHome, "session.json");
    }
    static forProfile(stateHome, profileId) {
        return new SessionStore(stateHome, profileId);
    }
    async ensureHome(stateHome) {
        await mkdir(stateHome, { recursive: true, mode: 0o700 });
    }
    async load() {
        try {
            const session = JSON.parse(await readFile(this.path, "utf8"));
            if (this.profileId && session.profile_id && session.profile_id !== this.profileId) {
                throw new Error(`session belongs to profile ${session.profile_id}, not ${this.profileId}; login again for this server`);
            }
            return session;
        }
        catch (err) {
            if (err.code === "ENOENT")
                return null;
            throw err;
        }
    }
    async save(session) {
        if (this.profileId && session.profile_id && session.profile_id !== this.profileId) {
            throw new Error(`refusing to save ${session.profile_id} session under ${this.profileId}`);
        }
        if (this.profileId)
            session.profile_id = this.profileId;
        await this.ensureHome(dirname(this.path));
        const tmp = `${this.path}.tmp`;
        await writeFile(tmp, JSON.stringify(session, null, 2), { mode: 0o600 });
        await rename(tmp, this.path);
    }
    async clear() {
        try {
            await rm(this.path);
        }
        catch (err) {
            if (err.code !== "ENOENT")
                throw err;
        }
    }
    async migrateLegacySession(stateHome) {
        if (!this.profileId)
            return false;
        const legacyPath = join(stateHome, "session.json");
        const legacy = new SessionStore(stateHome);
        const session = await legacy.load();
        if (!session || (session.profile_id && session.profile_id !== this.profileId))
            return false;
        try {
            await readFile(this.path, "utf8");
            return false;
        }
        catch (err) {
            if (err.code !== "ENOENT")
                throw err;
        }
        await this.save(session);
        return true;
    }
}
