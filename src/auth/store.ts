import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

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

function profileDirectory(profileId: string): string {
  const normalized = profileId.trim().toLowerCase();
  if (!normalized) throw new Error("profile id is required for profile session storage");
  return normalized.replace(/[^a-z0-9._-]/g, "_");
}

export class SessionStore {
  readonly path: string;

  constructor(
    stateHome: string,
    private readonly profileId?: string,
  ) {
    this.path = profileId
      ? join(stateHome, "profile-sessions", profileDirectory(profileId), "session.json")
      : join(stateHome, "session.json");
  }

  static forProfile(stateHome: string, profileId: string): SessionStore {
    return new SessionStore(stateHome, profileId);
  }

  async ensureHome(stateHome: string): Promise<void> {
    await mkdir(stateHome, { recursive: true, mode: 0o700 });
  }

  async load(): Promise<Session | null> {
    try {
      const session = JSON.parse(await readFile(this.path, "utf8")) as Session;
      if (this.profileId && session.profile_id && session.profile_id !== this.profileId) {
        throw new Error(`session belongs to profile ${session.profile_id}, not ${this.profileId}; login again for this server`);
      }
      return session;
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
  }

  async save(session: Session): Promise<void> {
    if (this.profileId && session.profile_id && session.profile_id !== this.profileId) {
      throw new Error(`refusing to save ${session.profile_id} session under ${this.profileId}`);
    }
    if (this.profileId) session.profile_id = this.profileId;
    await this.ensureHome(dirname(this.path));
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

  async migrateLegacySession(stateHome: string): Promise<boolean> {
    if (!this.profileId) return false;
    const legacyPath = join(stateHome, "session.json");
    const legacy = new SessionStore(stateHome);
    const session = await legacy.load();
    if (!session || (session.profile_id && session.profile_id !== this.profileId)) return false;
    try {
      await readFile(this.path, "utf8");
      return false;
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
    await this.save(session);
    return true;
  }
}
