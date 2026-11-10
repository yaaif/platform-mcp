import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { installTlsDispatcher } from "../client/tls.js";
import { copyScenario } from "../lib/scenarioCopy.js";
import { copySkill } from "../lib/skillCopy.js";
import { copyAmbientWorkflow } from "../lib/ambientCopy.js";
import { copyMcpServer } from "../lib/mcpServerCopy.js";
import { copyAgent } from "../lib/agentCopy.js";
import { copyCatalog, type CatalogResources } from "../lib/catalogCopy.js";
import { createProfileBundle, importProfileBundle } from "../lib/profileBundle.js";
import { applyProfileToConfig } from "../platform/profiles.js";
import { createRuntime } from "../runtime.js";
import { fail, ok } from "./helpers.js";
import type { Ctx } from "./ctx.js";

export function registerMigrationTools(server: McpServer, ctx: Ctx): void {
  server.registerTool("yaaif_platform_clone", {
    description: "Clone a server profile's endpoint/TLS configuration without copying its session or tokens. The destination must not already exist.",
    inputSchema: {
      source_profile_id: z.string(),
      destination_profile_id: z.string(),
      label: z.string().optional(),
      activate: z.boolean().optional(),
    },
  }, async ({ source_profile_id, destination_profile_id, label, activate }) => {
    try {
      const profile = await ctx.profiles.cloneCustom(source_profile_id, destination_profile_id, label);
      if (activate) {
        await ctx.profiles.setActive(profile.id);
        applyProfileToConfig(ctx.cfg, profile);
        await ctx.auth.useProfile(profile.id);
        installTlsDispatcher(ctx.cfg);
      }
      return ok(`Cloned profile ${source_profile_id} to ${destination_profile_id}; destination login is separate.`, {
        profile,
        activated: Boolean(activate),
        session_copied: false,
      });
    } catch (e) { return fail(String(e)); }
  });

  server.registerTool("yaaif_scenario_copy", {
    description: "Copy a Scenario as a new draft between two server profiles. Uses hash-verified release content but creates a new draft without bindings, release history, provenance, tenant ids, credentials or tokens. Dry-run by default; conflicts never overwrite.",
    inputSchema: {
      source_profile_id: z.string(),
      destination_profile_id: z.string(),
      spec_id: z.string(),
      revision: z.number().int().positive().optional(),
      new_slug: z.string().optional(),
      dry_run: z.boolean().optional(),
      confirm: z.boolean().optional(),
    },
  }, async (args) => {
    try {
      const source = await createRuntime(ctx.cfg.client, args.source_profile_id);
      const destination = await createRuntime(ctx.cfg.client, args.destination_profile_id);
      const result = await copyScenario({
        source,
        destination,
        specId: args.spec_id,
        revision: args.revision,
        newSlug: args.new_slug,
        dryRun: args.dry_run ?? true,
        confirm: args.confirm,
      });
      return ok(result.dry_run ? "Scenario copy preview ready; no destination writes were made." : "Scenario copied as a new draft.", result);
    } catch (e) { return fail(String(e)); }
  });

  server.registerTool("yaaif_catalog_copy", {
    description: "Preview and copy selected catalog resources in dependency order: MCP servers, skills, agents, ambient agents, workflows, then Scenarios. Aborts on any destination conflict and never copies sessions, credentials or bindings.",
    inputSchema: {
      source_profile_id: z.string(),
      destination_profile_id: z.string(),
      mcp_servers: z.array(z.string()).optional(),
      skills: z.array(z.string()).optional(),
      agents: z.array(z.string()).optional(),
      ambient_agents: z.array(z.string()).optional(),
      workflows: z.array(z.string()).optional(),
      scenarios: z.array(z.string()).optional(),
      workflow_agent_id: z.string().optional(),
      ambient_agent_id: z.string().optional(),
      dry_run: z.boolean().optional(),
      confirm: z.boolean().optional(),
    },
  }, async (args) => {
    try {
      const source = await createRuntime(ctx.cfg.client, args.source_profile_id);
      const destination = await createRuntime(ctx.cfg.client, args.destination_profile_id);
      const resources: CatalogResources = {
        mcpServers: args.mcp_servers,
        skills: args.skills,
        agents: args.agents,
        ambientAgents: args.ambient_agents,
        workflows: args.workflows,
        scenarios: args.scenarios,
      };
      const result = await copyCatalog({
        source,
        destination,
        ...resources,
        workflowAgentId: args.workflow_agent_id,
        ambientAgentId: args.ambient_agent_id,
        dryRun: args.dry_run ?? true,
        confirm: args.confirm,
      });
      return ok(result.dry_run ? "Catalog copy preview ready; no destination writes were made." : "Catalog resources copied in dependency order.", result);
    } catch (e) { return fail(String(e)); }
  });

  server.registerTool("yaaif_agent_copy", {
    description: "Copy an agent definition between profiles with prompt, description and type. Excludes skill mappings, Scenario bindings and activation state; creates the destination disabled for review. Dry-run by default; confirm required.",
    inputSchema: {
      source_profile_id: z.string(),
      destination_profile_id: z.string(),
      agent_id: z.string(),
      new_name: z.string().optional(),
      dry_run: z.boolean().optional(),
      confirm: z.boolean().optional(),
    },
  }, async (args) => {
    try {
      const source = await createRuntime(ctx.cfg.client, args.source_profile_id);
      const destination = await createRuntime(ctx.cfg.client, args.destination_profile_id);
      const result = await copyAgent({
        source,
        destination,
        agentId: args.agent_id,
        newName: args.new_name,
        dryRun: args.dry_run ?? true,
        confirm: args.confirm,
      });
      return ok(result.dry_run ? "Agent copy preview ready; no destination writes were made." : "Agent definition copied disabled for review.", result);
    } catch (e) { return fail(String(e)); }
  });

  server.registerTool("yaaif_mcp_server_copy", {
    description: "Copy an external MCP server connection between profiles with non-secret header mappings only. Excludes credential IDs, profiles, mappings, literal headers and tool refresh calls. Dry-run by default; destination conflicts and credential rebinding are explicit.",
    inputSchema: {
      source_profile_id: z.string(),
      destination_profile_id: z.string(),
      server_id: z.string(),
      new_name: z.string().optional(),
      new_endpoint: z.string().optional(),
      dry_run: z.boolean().optional(),
      confirm: z.boolean().optional(),
    },
  }, async (args) => {
    try {
      const source = await createRuntime(ctx.cfg.client, args.source_profile_id);
      const destination = await createRuntime(ctx.cfg.client, args.destination_profile_id);
      const result = await copyMcpServer({
        source,
        destination,
        serverId: args.server_id,
        newName: args.new_name,
        newEndpoint: args.new_endpoint,
        dryRun: args.dry_run ?? true,
        confirm: args.confirm,
      });
      return ok(result.dry_run ? "MCP server copy preview ready; no destination writes were made." : "MCP server connection copied without credentials.", result);
    } catch (e) { return fail(String(e)); }
  });

  server.registerTool("yaaif_ambient_workflow_copy", {
    description: "Copy an ambient workflow between server profiles with graph sanitization. Requires an existing destination ambient agent, strips server IDs/credentials/approval strategy/scenario bindings, and creates the workflow disabled with no run history. Dry-run by default; confirm required.",
    inputSchema: {
      source_profile_id: z.string(),
      destination_profile_id: z.string(),
      workflow_id: z.string(),
      new_name: z.string().optional(),
      ambient_agent_id: z.string().optional(),
      dry_run: z.boolean().optional(),
      confirm: z.boolean().optional(),
    },
  }, async (args) => {
    try {
      const source = await createRuntime(ctx.cfg.client, args.source_profile_id);
      const destination = await createRuntime(ctx.cfg.client, args.destination_profile_id);
      const result = await copyAmbientWorkflow({
        source,
        destination,
        workflowId: args.workflow_id,
        newName: args.new_name,
        ambientAgentId: args.ambient_agent_id,
        dryRun: args.dry_run ?? true,
        confirm: args.confirm,
      });
      return ok(result.dry_run ? "Ambient workflow copy preview ready; no destination writes were made." : "Ambient workflow copied disabled for review.", result);
    } catch (e) { return fail(String(e)); }
  });

  server.registerTool("yaaif_skill_copy", {
    description: "Copy a complete skill pack between server profiles with a new or existing id. Previews files, excludes credential/private-key material, avoids agent mappings and Scenario bindings, and refuses destination conflicts. Dry-run by default; confirm required to write.",
    inputSchema: {
      source_profile_id: z.string(),
      destination_profile_id: z.string(),
      skill_id: z.string(),
      new_skill_id: z.string().optional(),
      dry_run: z.boolean().optional(),
      confirm: z.boolean().optional(),
    },
  }, async (args) => {
    try {
      const source = await createRuntime(ctx.cfg.client, args.source_profile_id);
      const destination = await createRuntime(ctx.cfg.client, args.destination_profile_id);
      const result = await copySkill({
        source,
        destination,
        skillId: args.skill_id,
        newSkillId: args.new_skill_id,
        dryRun: args.dry_run ?? true,
        confirm: args.confirm,
      });
      return ok(result.dry_run ? "Skill copy preview ready; no destination writes were made." : "Skill pack copied.", result);
    } catch (e) { return fail(String(e)); }
  });

  server.registerTool("yaaif_platform_bundle_export", {
    description: "Export all server profiles and optional active profile as a portable configuration bundle. Sessions, tokens and secret contents are excluded.",
    inputSchema: {},
  }, async () => {
    try {
      const profiles = await ctx.profiles.listAll();
      const active = await ctx.profiles.getActive();
      const bundle = createProfileBundle(profiles, active?.profile_id);
      return ok("Exported profile configuration bundle without sessions.", { document: bundle });
    } catch (e) { return fail(String(e)); }
  });

  server.registerTool("yaaif_platform_bundle_import", {
    description: "Preview or import a profile configuration bundle without overwriting existing profiles or copying sessions. Requires confirm=true and dry_run=false to write.",
    inputSchema: {
      document: z.record(z.unknown()),
      activate: z.string().optional(),
      dry_run: z.boolean().optional(),
      confirm: z.boolean().optional(),
    },
  }, async ({ document, activate, dry_run, confirm }) => {
    try {
      const result = await importProfileBundle(ctx.profiles, document as never, { activate, dryRun: dry_run ?? true, confirm });
      if (activate && !(dry_run ?? true)) {
        const profile = await ctx.profiles.get(activate);
        if (profile) {
          applyProfileToConfig(ctx.cfg, profile);
          await ctx.auth.useProfile(profile.id);
          installTlsDispatcher(ctx.cfg);
        }
      }
      return ok(dry_run ?? true ? "Profile import preview ready; no profiles changed." : "Profile bundle imported without sessions.", result);
    } catch (e) { return fail(String(e)); }
  });
}
