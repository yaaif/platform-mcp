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
    private devicePending;
    constructor(cfg: Config, store: SessionStore);
    assertIssuerMatch(sess: Session | null): void;
    login(): Promise<{
        session: Session;
        auth_url: string;
    }>;
    /**
     * OAuth 2.0 device authorization grant (headless / CI).
     * Requires Keycloak client attribute oauth2.device.authorization.grant.enabled=true.
     * Clients with pkce.code.challenge.method=S256 also require PKCE on device start + token poll.
     *
     * Default wait=false returns verification_uri/user_code immediately and polls in the
     * background so MCP hosts (OpenCode/Cursor) do not hit tool timeouts before the agent
     * can show the code. Pass wait=true for blocking CI flows.
     */
    deviceLogin(opts?: {
        timeout_ms?: number;
        wait?: boolean;
    }): Promise<{
        status: "complete" | "pending";
        session?: Session;
        verification_uri: string;
        user_code: string;
    }>;
    private finishOrReportPending;
    private pollDeviceTokens;
    private persistTokens;
    logout(opts?: {
        endSession?: boolean;
    }): Promise<{
        logged_out: boolean;
        end_session_url?: string;
    }>;
    session(): Promise<Session | null>;
    setTenant(tenantId: string, tenantName?: string): Promise<Session>;
    patchSession(patch: Partial<Pick<Session, "dev_session_id" | "dev_agent_id" | "tenant_id" | "tenant_name">>): Promise<Session>;
    accessToken(): Promise<{
        token: string;
        session: Session;
    }>;
    private refresh;
}
