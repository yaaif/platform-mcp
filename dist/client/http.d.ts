import type { AuthClient } from "../auth/oidc.js";
import type { Config } from "../config.js";
export declare class ApiClient {
    readonly cfg: Config;
    private readonly auth;
    constructor(cfg: Config, auth: AuthClient);
    agentJSON<T = unknown>(method: string, path: string, body?: unknown): Promise<T>;
    apiJSON<T = unknown>(method: string, path: string, body?: unknown): Promise<T>;
    controlPlaneJSON<T = unknown>(method: string, path: string, body?: unknown): Promise<T>;
    approvalJSON<T = unknown>(method: string, path: string, body?: unknown): Promise<T>;
    private doJSON;
}
