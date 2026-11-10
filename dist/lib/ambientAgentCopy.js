function sanitizePolicy(value) {
    if (Array.isArray(value))
        return value.map(sanitizePolicy);
    if (value && typeof value === "object") {
        return Object.fromEntries(Object.entries(value)
            .filter(([key]) => !/credential_id|token|secret|password|spec_id|slot_key/i.test(key))
            .map(([key, nested]) => [key, sanitizePolicy(nested)]));
    }
    return value;
}
export async function copyAmbientAgent(options) {
    const { source, destination, ambientAgentId, workflowAgentId, dryRun, confirm } = options;
    const sourceView = await source.api.agentJSON("GET", `/api/ambient/agents/${encodeURIComponent(ambientAgentId)}`);
    const agent = sourceView.ambient_agent ?? sourceView;
    if (!agent.name)
        throw new Error(`ambient agent not found: ${ambientAgentId}`);
    let destinationWorkflowAgentId = workflowAgentId?.trim() || "";
    if (!destinationWorkflowAgentId) {
        const sourceWorkflowAgent = await source.api.agentJSON("GET", `/api/agents/${encodeURIComponent(agent.agent_id ?? "")}`);
        const destinationAgents = await destination.api.agentJSON("GET", `/api/agents?q=${encodeURIComponent(sourceWorkflowAgent.name ?? "")}&limit=200`);
        destinationWorkflowAgentId = destinationAgents.items?.find((item) => item.name === sourceWorkflowAgent.name)?.id ?? "";
        if (!destinationWorkflowAgentId)
            throw new Error(`destination workflow agent not found: ${sourceWorkflowAgent.name ?? agent.agent_id}; copy it first or pass --workflow-agent-id`);
    }
    const existing = await destination.api.agentJSON("GET", `/api/ambient/agents?q=${encodeURIComponent(agent.name)}&limit=200`);
    const conflict = Boolean((existing.items ?? []).find((item) => item.name === agent.name));
    const preview = {
        ambient_agent_id: ambientAgentId,
        name: agent.name,
        workflow_agent_id: destinationWorkflowAgentId,
        source_profile_id: source.cfg.activeProfileId,
        destination_profile_id: destination.cfg.activeProfileId,
        conflict,
        enabled_for_review: false,
        workflow_async_enabled: false,
        requires_approval: false,
        triggers_copied: false,
        credentials_copied: false,
    };
    if (dryRun)
        return { dry_run: true, ...preview };
    if (!confirm)
        throw new Error("review the ambient agent copy preview first, then rerun with --yes");
    if (conflict)
        throw new Error(`destination ambient agent already exists: ${agent.name}; copy with a different name is not supported for this resource`);
    const created = await destination.api.agentJSON("POST", "/api/ambient/agents", {
        agent_id: destinationWorkflowAgentId,
        name: agent.name,
        description: agent.description ?? "",
        mode: agent.mode ?? "active",
        enabled: false,
        workflow_async_enabled: false,
        requires_approval: false,
        policy: sanitizePolicy(agent.policy ?? {}),
    });
    const createdId = created.id ?? agent.name;
    const verified = await destination.api.agentJSON("GET", `/api/ambient/agents/${encodeURIComponent(createdId)}`);
    return { dry_run: false, ...preview, created: { id: createdId, verified } };
}
