export async function copyAgent(options) {
    const { source, destination, agentId, newName, dryRun, confirm } = options;
    const agent = await source.api.agentJSON("GET", `/api/agents/${encodeURIComponent(agentId)}`);
    if (!agent.name)
        throw new Error(`agent not found: ${agentId}`);
    const name = newName?.trim() || agent.name;
    const existing = await destination.api.agentJSON("GET", `/api/agents?q=${encodeURIComponent(name)}&limit=200`);
    const conflict = Boolean((existing.items ?? []).find((item) => item.name === name));
    const preview = {
        agent_id: agentId,
        name,
        agent_type: agent.agent_type ?? "chat",
        source_profile_id: source.cfg.activeProfileId,
        destination_profile_id: destination.cfg.activeProfileId,
        conflict,
        required_skill_ids: agent.skill_ids ?? [],
        skill_mappings_copied: false,
        scenario_bindings_copied: false,
        enabled_for_review: false,
    };
    if (dryRun)
        return { dry_run: true, ...preview };
    if (!confirm)
        throw new Error("review the agent copy preview first, then rerun with --yes");
    if (conflict)
        throw new Error(`destination agent already exists: ${name}; choose --new-name`);
    const created = await destination.api.agentJSON("POST", "/api/agents", {
        name,
        description: agent.description ?? "",
        goal_prompt: agent.goal_prompt ?? "",
        agent_type: agent.agent_type ?? "chat",
        skill_ids: [],
        enabled: false,
    });
    const createdId = created.id ?? name;
    const verified = await destination.api.agentJSON("GET", `/api/agents/${encodeURIComponent(createdId)}`);
    return { dry_run: false, ...preview, created: { id: createdId, verified } };
}
