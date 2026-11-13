import type { SessionStore } from "../auth/store.js";
/**
 * A locked installation's profile starts without a session when an agent had
 * signed in under another profile name for the same issuer. Take the newest
 * such session (same issuer, so its tokens are valid here) instead of asking
 * the user to sign in again. The original file stays where it is.
 * Returns the profile id the session came from, or null.
 */
export declare function adoptIssuerSession(stateHome: string, store: SessionStore, profileId: string, authority: string): Promise<string | null>;
