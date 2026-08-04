import type { Config } from "../config.js";
import type { Session, SessionStore } from "./store.js";
export declare class ReauthRequiredError extends Error {
    readonly code = "reauth_required";
    constructor(message: string);
}
export declare class IssuerMismatchError extends Error {
    readonly sessionAuthority: string;
    readonly configAuthority: string;
    readonly code = "issuer_mismatch";
    constructor(message: string, sessionAuthority: string, configAuthority: string);
}
export declare class AuthClient {
    private readonly cfg;
    private readonly store;
    constructor(cfg: Config, store: SessionStore);
    assertIssuerMatch(sess: Session | null): void;
    login(): Promise<{
        session: Session;
        auth_url: string;
    }>;
    logout(opts?: {
        endSession?: boolean;
    }): Promise<{
        logged_out: boolean;
        end_session_url?: string;
    }>;
    session(): Promise<Session | null>;
    setTenant(tenantId: string, tenantName?: string): Promise<Session>;
    accessToken(): Promise<{
        token: string;
        session: Session;
    }>;
    private refresh;
}
