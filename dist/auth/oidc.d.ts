import type { Config } from "../config.js";
import type { Session, SessionStore } from "./store.js";
export declare class AuthClient {
    private readonly cfg;
    private readonly store;
    constructor(cfg: Config, store: SessionStore);
    login(): Promise<Session>;
    logout(): Promise<void>;
    session(): Promise<Session | null>;
    setTenant(tenantId: string): Promise<Session>;
    accessToken(): Promise<{
        token: string;
        session: Session;
    }>;
    private refresh;
}
