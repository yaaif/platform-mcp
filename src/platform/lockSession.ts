import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import type { Session, SessionStore } from "../auth/store.js";

function normalizeAuthority(value: string | undefined): string {
  return String(value ?? "").trim().replace(/\/+$/, "").toLowerCase();
}

/**
 * A locked installation's profile starts without a session when an agent had
 * signed in under another profile name for the same issuer. Take the newest
 * such session (same issuer, so its tokens are valid here) instead of asking
 * the user to sign in again. The original file stays where it is.
 * Returns the profile id the session came from, or null.
 */
export async function adoptIssuerSession(stateHome: string, store: SessionStore, profileId: string, authority: string): Promise<string | null> {
  if (await store.load().catch(() => null)) return null;
  const want = normalizeAuthority(authority);
  const root = join(stateHome, "profile-sessions");
  const candidates: { path: string; mtimeMs: number; session: Session }[] = [];
  for (const entry of await readdir(root, { withFileTypes: true }).catch(() => [])) {
    if (!entry.isDirectory()) continue;
    const path = join(root, entry.name, "session.json");
    try {
      const session = JSON.parse(await readFile(path, "utf8")) as Session;
      if (normalizeAuthority(session.oidc_authority) !== want) continue;
      if (!session.tokens?.refresh_token && !session.tokens?.access_token) continue;
      candidates.push({ path, mtimeMs: (await stat(path)).mtimeMs, session });
    } catch {
      // Unreadable or not a session: skip it.
    }
  }
  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
  const newest = candidates[0];
  if (!newest) return null;
  const from = newest.session.profile_id ?? null;
  await store.save({ ...newest.session, profile_id: profileId });
  return from;
}
