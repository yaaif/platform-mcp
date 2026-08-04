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
    subject?: string;
    email?: string;
    name?: string;
};
export declare class SessionStore {
    readonly path: string;
    constructor(cursorHome: string);
    ensureHome(cursorHome: string): Promise<void>;
    load(): Promise<Session | null>;
    save(session: Session): Promise<void>;
    clear(): Promise<void>;
}
