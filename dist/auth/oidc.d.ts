import type { Config } from "../config.js";
import { SessionStore, type Session } from "./store.js";
/** Browser sign-in needs a browser on this machine; OpenCode runs on a server. */
export declare class BrowserLoginUnavailableError extends Error {
    constructor(label: string);
}
export declare function browserLoginAvailable(cfg: Pick<Config, "client">): boolean;
/**
 * Opens a URL in the local browser when there is one. A missing launcher
 * (no xdg-open in a container) fails the spawn with an "error" event that
 * would otherwise crash the MCP server.
 */
export declare function openInBrowser(url: string, onFail?: (error: unknown) => void): void;
/** The identity provider refused the refresh token itself (invalid_grant, revoked, expired). */
export declare class RefreshRejectedError extends Error {
    constructor(message: string);
}
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
export declare class DeviceLoginCancelledError extends Error {
    constructor();
}
export declare class AuthClient {
    private readonly cfg;
    private profileStore;
    private devicePending;
    /** Lower bound on the device poll interval in seconds (tests lower it). */
    minPollSec: number;
    constructor(cfg: Config, profileStore: SessionStore);
    /**
     * The session store of the active profile. Tools switch profiles by applying
     * one to cfg (platform_use, platform_save activate, ensure_session
     * profile_id, the CLI); the store follows cfg here so none of them can leave
     * sessions read from, or tokens saved to, the previous profile.
     */
    private get store();
    private switchStore;
    useProfile(profileId: string): Promise<void>;
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
        expires_at?: string;
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
    /**
     * OpenCode runs tool calls in parallel, so several can find the token expired
     * at once. Rotating refresh tokens only allow one use, so share one refresh.
     */
    private refreshing;
    private refreshOnce;
    private refreshOrRecover;
    private refresh;
}
