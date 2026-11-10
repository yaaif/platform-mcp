import { copyAgent } from "./agentCopy.js";
import { copyAmbientAgent } from "./ambientAgentCopy.js";
import { copyAmbientWorkflow } from "./ambientCopy.js";
import { copyMcpServer } from "./mcpServerCopy.js";
import { copyScenario } from "./scenarioCopy.js";
import { copySkill } from "./skillCopy.js";
export async function copyCatalog(options) {
    const { source, destination, dryRun, confirm } = options;
    const resources = [
        ...(options.mcpServers ?? []).map((id) => ({ kind: "mcp-server", id })),
        ...(options.skills ?? []).map((id) => ({ kind: "skill", id })),
        ...(options.agents ?? []).map((id) => ({ kind: "agent", id })),
        ...(options.ambientAgents ?? []).map((id) => ({ kind: "ambient-agent", id })),
        ...(options.workflows ?? []).map((id) => ({ kind: "workflow", id })),
        ...(options.scenarios ?? []).map((id) => ({ kind: "scenario", id })),
    ];
    if (!resources.length)
        throw new Error("select at least one resource to copy");
    if (resources.length > 100)
        throw new Error("catalog copy is limited to 100 resources");
    const previews = [];
    for (const resource of resources) {
        if (resource.kind === "mcp-server")
            previews.push(await copyMcpServer({ source, destination, serverId: resource.id, dryRun: true }));
        if (resource.kind === "skill")
            previews.push(await copySkill({ source, destination, skillId: resource.id, dryRun: true }));
        if (resource.kind === "agent")
            previews.push(await copyAgent({ source, destination, agentId: resource.id, dryRun: true }));
        if (resource.kind === "ambient-agent")
            previews.push(await copyAmbientAgent({ source, destination, ambientAgentId: resource.id, workflowAgentId: options.workflowAgentId, dryRun: true }));
        if (resource.kind === "workflow")
            previews.push(await copyAmbientWorkflow({ source, destination, workflowId: resource.id, ambientAgentId: options.ambientAgentId, dryRun: true }));
        if (resource.kind === "scenario")
            previews.push(await copyScenario({ source, destination, specId: resource.id, dryRun: true }));
    }
    const conflicts = previews.flatMap((preview) => {
        const direct = preview.conflict === true ? [String(preview.name ?? preview.new_skill_id ?? preview.slug ?? preview.server_id ?? preview.workflow_id ?? preview.ambient_agent_id ?? preview.agent_id ?? "resource")] : [];
        const conflictsField = Array.isArray(preview.conflicts) ? preview.conflicts.map(String) : [];
        return [...direct, ...conflictsField];
    });
    const preview = {
        dry_run: true,
        source_profile_id: source.cfg.activeProfileId,
        destination_profile_id: destination.cfg.activeProfileId,
        resource_count: resources.length,
        resources: previews,
        conflicts,
        dependency_order: ["mcp-server", "skill", "agent", "ambient-agent", "workflow", "scenario"],
        sessions_copied: false,
        credentials_copied: false,
    };
    if (dryRun)
        return preview;
    if (!confirm)
        throw new Error("review the catalog copy preview first, then rerun with --yes");
    if (conflicts.length)
        throw new Error(`catalog copy has destination conflicts: ${[...new Set(conflicts)].join(", ")}`);
    const applied = [];
    for (const resource of resources) {
        let result;
        if (resource.kind === "mcp-server")
            result = await copyMcpServer({ source, destination, serverId: resource.id, dryRun: false, confirm: true });
        if (resource.kind === "skill")
            result = await copySkill({ source, destination, skillId: resource.id, dryRun: false, confirm: true });
        if (resource.kind === "agent")
            result = await copyAgent({ source, destination, agentId: resource.id, dryRun: false, confirm: true });
        if (resource.kind === "ambient-agent")
            result = await copyAmbientAgent({ source, destination, ambientAgentId: resource.id, workflowAgentId: options.workflowAgentId, dryRun: false, confirm: true });
        if (resource.kind === "workflow")
            result = await copyAmbientWorkflow({ source, destination, workflowId: resource.id, ambientAgentId: options.ambientAgentId, dryRun: false, confirm: true });
        if (resource.kind === "scenario")
            result = await copyScenario({ source, destination, specId: resource.id, dryRun: false, confirm: true });
        applied.push({ kind: resource.kind, id: resource.id, result });
    }
    return { ...preview, dry_run: false, applied };
}
