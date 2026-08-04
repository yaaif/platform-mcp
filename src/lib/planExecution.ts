import { mkdir, readFile, rename, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export type PlanExecStep = {
  id: string;
  tool: string;
  arguments?: Record<string, unknown>;
  note?: string;
  status: "pending" | "done" | "failed" | "skipped";
  result_ids?: Record<string, string>;
  error?: string;
  updated_at?: string;
};

export type PlanExecution = {
  slug: string;
  plan_path?: string;
  tenant_id?: string;
  profile_id?: string;
  created_at: string;
  updated_at: string;
  steps: PlanExecStep[];
};

export class PlanExecutionStore {
  readonly dir: string;

  constructor(cursorHome: string) {
    this.dir = join(cursorHome, "plan-executions");
  }

  private file(slug: string): string {
    const safe = slug.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-");
    return join(this.dir, `${safe}.json`);
  }

  async save(exec: PlanExecution): Promise<PlanExecution> {
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    const next = { ...exec, updated_at: new Date().toISOString() };
    const path = this.file(exec.slug);
    const tmp = `${path}.tmp`;
    await writeFile(tmp, JSON.stringify(next, null, 2), { mode: 0o600 });
    await rename(tmp, path);
    return next;
  }

  async get(slug: string): Promise<PlanExecution | null> {
    try {
      return JSON.parse(await readFile(this.file(slug), "utf8")) as PlanExecution;
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
  }

  async list(): Promise<{ slug: string; updated_at: string; pending: number; failed: number }[]> {
    try {
      const names = await readdir(this.dir);
      const out = [];
      for (const name of names) {
        if (!name.endsWith(".json")) continue;
        const exec = await this.get(name.replace(/\.json$/, ""));
        if (!exec) continue;
        out.push({
          slug: exec.slug,
          updated_at: exec.updated_at,
          pending: exec.steps.filter((s) => s.status === "pending").length,
          failed: exec.steps.filter((s) => s.status === "failed").length,
        });
      }
      return out.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw err;
    }
  }

  resumeHint(exec: PlanExecution) {
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
