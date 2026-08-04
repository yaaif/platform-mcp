import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
export class SessionStore {
    path;
    constructor(cursorHome) {
        this.path = join(cursorHome, "session.json");
    }
    async ensureHome(cursorHome) {
        await mkdir(cursorHome, { recursive: true, mode: 0o700 });
    }
    async load() {
        try {
            const raw = await readFile(this.path, "utf8");
            return JSON.parse(raw);
        }
        catch (err) {
            if (err.code === "ENOENT")
                return null;
            throw err;
        }
    }
    async save(session) {
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
}
