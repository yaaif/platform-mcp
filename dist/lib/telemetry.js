import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
export class TelemetryStore {
    cursorHome;
    path;
    constructor(cursorHome) {
        this.cursorHome = cursorHome;
        this.path = join(cursorHome, "telemetry.json");
    }
    async load() {
        try {
            const raw = JSON.parse(await readFile(this.path, "utf8"));
            return {
                enabled: Boolean(raw.enabled),
                counters: raw.counters && typeof raw.counters === "object" ? raw.counters : {},
                updated_at: raw.updated_at,
            };
        }
        catch (err) {
            if (err.code === "ENOENT") {
                return { enabled: false, counters: {} };
            }
            throw err;
        }
    }
    async save(state) {
        await mkdir(this.cursorHome, { recursive: true, mode: 0o700 });
        const next = { ...state, updated_at: new Date().toISOString() };
        const tmp = `${this.path}.tmp`;
        await writeFile(tmp, JSON.stringify(next, null, 2), { mode: 0o600 });
        await rename(tmp, this.path);
    }
    async setEnabled(enabled) {
        const cur = await this.load();
        cur.enabled = enabled;
        await this.save(cur);
        return cur;
    }
    async increment(name, by = 1) {
        const cur = await this.load();
        if (!cur.enabled)
            return;
        cur.counters[name] = (cur.counters[name] ?? 0) + by;
        await this.save(cur);
    }
}
/** Redact secrets from objects before logging or returning diagnostics. */
export function redactSecrets(value) {
    if (Array.isArray(value))
        return value.map(redactSecrets);
    if (!value || typeof value !== "object")
        return value;
    const out = {};
    for (const [k, v] of Object.entries(value)) {
        const key = k.toLowerCase();
        if (key.includes("token") ||
            key.includes("secret") ||
            key.includes("password") ||
            key.includes("authorization") ||
            key.includes("refresh") ||
            key === "id_token" ||
            key === "access_token") {
            out[k] = typeof v === "string" && v ? "[redacted]" : v;
        }
        else {
            out[k] = redactSecrets(v);
        }
    }
    return out;
}
