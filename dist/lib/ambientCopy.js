const SERVER_IDS = new Set([
    "agent_id",
    "credential_id",
    "approval_strategy_id",
    "spec_id",
    "slot_key",
    "allowed_child_workflow_ids",
    "allowed_agent_ids",
]);
function sanitize(value, dependencies, key = "") {
    if (SERVER_IDS.has(key) || /token|secret|password/i.test(key)) {
        dependencies.add(key);
        return undefined;
    }
    if (key === "credential_profile") {
        dependencies.add(key);
        return value;
    }
    if (Array.isArray(value))
        return value.map((item) => sanitize(item, dependencies));
    if (value && typeof value === "object") {
        return Object.fromEntries(Object.entries(value)
            .map(([nestedKey, nestedValue]) => [nestedKey, sanitize(nestedValue, dependencies, nestedKey)])
            .filter(([, nestedValue]) => nestedValue !== undefined));
    }
    return value;
}
export async function copyAmbientWorkflow(options) {
    const { source, destination, workflowId, newName, ambientAgentId, dryRun, confirm } = options;
    const sourceView = await source.api.agentJSON("GET", `/api/ambient/workflows/${encodeURIComponent(workflowId)}`);
    const workflow = sourceView.workflow ?? sourceView;
    if (!workflow?.name)
        throw new Error(`ambient workflow not found: ${workflowId}`);
    let destinationAgentId = ambientAgentId?.trim() || "";
    if (!destinationAgentId) {
        const sourceAgentView = await source.api.agentJSON("GET", `/api/ambient/agents/${encodeURIComponent(workflow.ambient_agent_id ?? "")}`);
        const sourceAgent = sourceAgentView.ambient_agent ?? sourceAgentView;
        const destinationAgents = await destination.api.agentJSON("GET", `/api/ambient/agents?q=${encodeURIComponent(sourceAgent?.name ?? "")}&limit=200`);
        destinationAgentId = destinationAgents.items?.find((agent) => agent.name === sourceAgent?.name)?.id ?? "";
        if (!destinationAgentId) {
            throw new Error(`destination ambient agent not found: ${sourceAgent?.name ?? workflow.ambient_agent_id}; create it first or pass --ambient-agent-id`);
        }
    }
    const name = newName?.trim() || workflow.name;
    const existing = await destination.api.agentJSON("GET", `/api/ambient/workflows?ambient_agent_id=${encodeURIComponent(destinationAgentId)}&limit=200`);
    const conflict = Boolean((existing.items ?? []).find((item) => item.name === name));
    const dependencies = new Set();
    const graph = sanitize(workflow.workflow_graph ?? {}, dependencies);
    const policy = sanitize(workflow.policy ?? {}, dependencies);
    const triggers = sanitize(workflow.trigger_rules ?? [], dependencies);
    const preview = {
        workflow_id: workflowId,
        name,
        ambient_agent_id: destinationAgentId,
        source_profile_id: source.cfg.activeProfileId,
        destination_profile_id: destination.cfg.activeProfileId,
        conflict,
        dependencies: [...dependencies].sort(),
        disabled_for_review: true,
        workflow_async_enabled: false,
        requires_approval: false,
        run_history_copied: false,
        credentials_copied: false,
    };
    if (dryRun)
        return { dry_run: true, ...preview };
    if (!confirm)
        throw new Error("review the ambient workflow copy preview first, then rerun with --yes");
    if (conflict)
        throw new Error(`destination workflow already exists: ${name}; choose --new-name`);
    const created = await destination.api.agentJSON("POST", `/api/ambient/agents/${encodeURIComponent(destinationAgentId)}/workflows`, {
        name,
        description: workflow.description ?? "",
        enabled: false,
        workflow_async_enabled: false,
        requires_approval: false,
        workflow_graph: graph,
        policy,
        trigger_rules: triggers,
    });
    const createdId = created.id ?? name;
    const verified = await destination.api.agentJSON("GET", `/api/ambient/workflows/${encodeURIComponent(createdId)}`);
    return { dry_run: false, ...preview, created: { id: createdId, verified } };
}
