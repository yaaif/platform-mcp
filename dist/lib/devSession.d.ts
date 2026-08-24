import type { Ctx } from "../tools/ctx.js";
export type DevSessionPatch = {
    session_id?: string;
    agent_id?: string;
};
export declare function persistDevSession(ctx: Ctx, result: DevSessionPatch): Promise<void>;
export declare function resolveDevSessionId(ctx: Ctx, explicit?: string): Promise<string | undefined>;
export declare function resolveDevAgentId(ctx: Ctx, explicit?: string): Promise<string | undefined>;
/** Reuse the persisted authoring session, or create one via agent-service. */
export declare function ensureDevSession(ctx: Ctx, opts?: {
    session_id?: string;
    agent_id?: string;
    force_new?: boolean;
}): Promise<{
    session_id: string;
    agent_id: string;
    reused: boolean;
}>;
