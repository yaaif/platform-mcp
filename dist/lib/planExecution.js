import { mkdir, readFile, rename, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
export class PlanExecutionStore {
    dir;
    constructor(cursorHome) {
        this.dir = join(cursorHome, "plan-executions");
    }
    file(slug) {
        const safe = slug.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-");
        return join(this.dir, `${safe}.json`);
    }
    async save(exec) {
        await mkdir(this.dir, { recursive: true, mode: 0o700 });
        const next = { ...exec, updated_at: new Date().toISOString() };
        const path = this.file(exec.slug);
        const tmp = `${path}.tmp`;
        await writeFile(tmp, JSON.stringify(next, null, 2), { mode: 0o600 });
        await rename(tmp, path);
        return next;
    }
    async get(slug) {
        try {
            return JSON.parse(await readFile(this.file(slug), "utf8"));
        }
        catch (err) {
            if (err.code === "ENOENT")
                return null;
            throw err;
        }
    }
    async list() {
        try {
            const names = await readdir(this.dir);
            const out = [];
            for (const name of names) {
                if (!name.endsWith(".json"))
                    continue;
                const exec = await this.get(name.replace(/\.json$/, ""));
                if (!exec)
                    continue;
                out.push({
                    slug: exec.slug,
                    updated_at: exec.updated_at,
                    pending: exec.steps.filter((s) => s.status === "pending").length,
                    failed: exec.steps.filter((s) => s.status === "failed").length,
                });
            }
            return out.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
        }
        catch (err) {
            if (err.code === "ENOENT")
                return [];
            throw err;
        }
    }
    resumeHint(exec) {
        const next = exec.steps.find((s) => s.status === "pending" || s.status === "failed");
        const done = exec.steps.filter((s) => s.status === "done" || s.status === "skipped");
        return {
            complete: !next,
            next_step: next ?? null,
            remaining: exec.steps.filter((s) => s.status === "pending" || s.status === "failed"),
            completed_count: done.length,
            total: exec.steps.length,
            collected_ids: Object.assign({}, ...done.map((s) => s.result_ids ?? {})),
        };
    }
}
