import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

export type TokenSet = {
  access_token: string;
  refresh_token?: string;
  token_type?: string;
  expiry: string;
  id_token?: string;
};

export type Session = {
  tokens: TokenSet;
  tenant_id?: string;
  tenant_name?: string;
  subject?: string;
  email?: string;
  name?: string;
  /** Named platform profile used when tokens were issued. */
  profile_id?: string;
  /** OIDC authority / issuer URL at login time. */
  oidc_authority?: string;
  /** Short-lived authoring session for files_* / state local tools. */
  dev_session_id?: string;
  /** Optional agent id used with the authoring session. */
  dev_agent_id?: string;
};

export class SessionStore {
  readonly path: string;

  constructor(stateHome: string) {
    this.path = join(stateHome, "session.json");
  }

  async ensureHome(stateHome: string): Promise<void> {
    await mkdir(stateHome, { recursive: true, mode: 0o700 });
  }

  async load(): Promise<Session | null> {
    try {
      const raw = await readFile(this.path, "utf8");
      return JSON.parse(raw) as Session;
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
  }

  async save(session: Session): Promise<void> {
    const tmp = `${this.path}.tmp`;
    await writeFile(tmp, JSON.stringify(session, null, 2), { mode: 0o600 });
    await rename(tmp, this.path);
  }

  async clear(): Promise<void> {
    try {
      await rm(this.path);
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
  }
}
