import type { AuthClient } from "../auth/oidc.js";
import type { Config } from "../config.js";
export type ApiRequestOpts = {
    timeoutMs?: number;
};
export type ApiFormFile = {
    field?: string;
    filename: string;
    body: Buffer;
    contentType?: string;
};
export declare class ApiClient {
    readonly cfg: Config;
    private readonly auth;
    constructor(cfg: Config, auth: AuthClient);
    agentJSON<T = unknown>(method: string, path: string, body?: unknown, opts?: ApiRequestOpts): Promise<T>;
    apiJSON<T = unknown>(method: string, path: string, body?: unknown, opts?: ApiRequestOpts): Promise<T>;
    controlPlaneJSON<T = unknown>(method: string, path: string, body?: unknown, opts?: ApiRequestOpts): Promise<T>;
    approvalJSON<T = unknown>(method: string, path: string, body?: unknown, opts?: ApiRequestOpts): Promise<T>;
    apiForm<T = unknown>(method: string, path: string, fields: Record<string, string>, file: ApiFormFile, opts?: ApiRequestOpts): Promise<T>;
    private authHeaders;
    private doJSON;
    private doForm;
    private parseJSON;
}
