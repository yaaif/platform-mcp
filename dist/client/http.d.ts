import type { AuthClient } from "../auth/oidc.js";
import type { Config } from "../config.js";
export type ApiRequestOpts = {
    timeoutMs?: number;
    headers?: Record<string, string>;
    expectedContext?: {
        subject: string;
        tenant: string;
        profile: string;
        origin: string;
    };
    onResponse?: (response: Response) => void;
};
export type ApiFormFile = {
    field?: string;
    filename: string;
    body: Buffer;
    contentType?: string;
};
/**
 * Error bodies go straight into the model's context. A gateway error page or a
 * stack trace can be many kilobytes, so keep the start and say what was cut.
 */
export declare function boundedErrorText(text: string, max?: number): string;
export declare class ApiClient {
    readonly cfg: Config;
    private readonly auth;
    constructor(cfg: Config, auth: AuthClient);
    agentJSON<T = unknown>(method: string, path: string, body?: unknown, opts?: ApiRequestOpts): Promise<T>;
    apiJSON<T = unknown>(method: string, path: string, body?: unknown, opts?: ApiRequestOpts): Promise<T>;
    controlPlaneJSON<T = unknown>(method: string, path: string, body?: unknown, opts?: ApiRequestOpts): Promise<T>;
    approvalJSON<T = unknown>(method: string, path: string, body?: unknown, opts?: ApiRequestOpts): Promise<T>;
    /** Product docs are public. No bearer token or tenant header. */
    docsJSON<T = unknown>(method: string, path: string, opts?: ApiRequestOpts): Promise<T>;
    apiForm<T = unknown>(method: string, path: string, fields: Record<string, string>, file: ApiFormFile, opts?: ApiRequestOpts): Promise<T>;
    private authHeaders;
    private doPublicJSON;
    private doJSON;
    private doForm;
    private parseJSON;
}
