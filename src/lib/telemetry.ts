import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

export type TelemetryState = {
  enabled: boolean;
  counters: Record<string, number>;
  updated_at?: string;
};

export class TelemetryStore {
  readonly path: string;

  constructor(private readonly cursorHome: string) {
    this.path = join(cursorHome, "telemetry.json");
  }

  async load(): Promise<TelemetryState> {
    try {
      const raw = JSON.parse(await readFile(this.path, "utf8")) as TelemetryState;
      return {
        enabled: Boolean(raw.enabled),
        counters: raw.counters && typeof raw.counters === "object" ? raw.counters : {},
        updated_at: raw.updated_at,
      };
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return { enabled: false, counters: {} };
      }
      throw err;
    }
  }

  async save(state: TelemetryState): Promise<void> {
    await mkdir(this.cursorHome, { recursive: true, mode: 0o700 });
    const next = { ...state, updated_at: new Date().toISOString() };
    const tmp = `${this.path}.tmp`;
    await writeFile(tmp, JSON.stringify(next, null, 2), { mode: 0o600 });
    await rename(tmp, this.path);
  }

  async setEnabled(enabled: boolean): Promise<TelemetryState> {
    const cur = await this.load();
    cur.enabled = enabled;
    await this.save(cur);
    return cur;
  }

  async increment(name: string, by = 1): Promise<void> {
    const cur = await this.load();
    if (!cur.enabled) return;
    cur.counters[name] = (cur.counters[name] ?? 0) + by;
    await this.save(cur);
  }
}

/** Redact secrets from objects before logging or returning diagnostics. */
export function redactSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (!value || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const key = k.toLowerCase();
    if (
      key.includes("token") ||
      key.includes("secret") ||
      key.includes("password") ||
      key.includes("authorization") ||
      key.includes("refresh") ||
      key === "id_token" ||
      key === "access_token"
    ) {
      out[k] = typeof v === "string" && v ? "[redacted]" : v;
    } else {
      out[k] = redactSecrets(v);
    }
  }
  return out;
}
