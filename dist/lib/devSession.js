export async function persistDevSession(ctx, result) {
    await ctx.auth.patchSession({
        dev_session_id: result.session_id,
        dev_agent_id: result.agent_id,
    });
}
export async function resolveDevSessionId(ctx, explicit) {
    if (explicit?.trim())
        return explicit.trim();
    const sess = await ctx.auth.session();
    return sess?.dev_session_id?.trim() || undefined;
}
export async function resolveDevAgentId(ctx, explicit) {
    if (explicit?.trim())
        return explicit.trim();
    const sess = await ctx.auth.session();
    return sess?.dev_agent_id?.trim() || undefined;
}
/** Reuse persisted Cursor authoring session, or create one via agent-service. */
export async function ensureDevSession(ctx, opts = {}) {
    if (!opts.force_new) {
        const existing = await resolveDevSessionId(ctx, opts.session_id);
        if (existing) {
            const agentId = (await resolveDevAgentId(ctx, opts.agent_id)) || "";
            return { session_id: existing, agent_id: agentId, reused: true };
        }
    }
    const result = await ctx.api.agentJSON("POST", "/api/local-tools/dev-session", {
        session_id: opts.session_id || undefined,
        agent_id: opts.agent_id || undefined,
    });
    const sessionId = String(result.session_id || "").trim();
    if (!sessionId) {
        throw new Error("dev-session response missing session_id");
    }
    await persistDevSession(ctx, result);
    return {
        session_id: sessionId,
        agent_id: String(result.agent_id || opts.agent_id || "").trim(),
        reused: false,
    };
}
