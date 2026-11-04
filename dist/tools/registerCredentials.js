import { randomUUID } from "node:crypto";
import { z } from "zod";
import { fail, ok } from "./helpers.js";
import { appendClampedLimit } from "../lib/catalogLimits.js";
const bindingSchema = z.object({
    binding_name: z.string(),
    credential_kind: z.string().optional(),
    field_map: z.record(z.string()),
});
const argInjectionSchema = z.object({
    version: z.number().int().default(1),
    bindings: z.array(z.object({
        binding: z.string(),
        inject: z.record(z.record(z.string())),
    })),
});
/** Credential views never carry values; keep only metadata in tool output. */
function credentialSummary(view) {
    if (!view)
        return undefined;
    const { id, scope, kind, display_name, key_names, status, current_version } = view;
    return { id, scope, kind, display_name, key_names, status, current_version };
}
function toolArgs(tool) {
    let schema = tool.input_schema;
    if (typeof schema === "string") {
        try {
            schema = JSON.parse(schema);
        }
        catch {
            schema = {};
        }
    }
    const properties = schema?.properties ?? {};
    return new Set(Object.keys(properties));
}
/** Apply one argument map to every server tool that declares those arguments. */
export function injectAcrossTools(tools, args) {
    const inject = {};
    for (const tool of tools) {
        const name = (tool.name ?? "").trim();
        if (!name)
            continue;
        const present = toolArgs(tool);
        const map = Object.fromEntries(Object.entries(args).filter(([arg]) => present.has(arg)));
        if (Object.keys(map).length)
            inject[name] = map;
    }
    return inject;
}
export function registerCredentialTools(server, ctx) {
    server.registerTool("yaaif_credential_list", {
        description: "List tenant credentials (metadata and key names only; values are never returned).",
        inputSchema: { kind: z.string().optional(), q: z.string().optional(), limit: z.number().optional() },
    }, async ({ kind, q, limit }) => {
        const params = new URLSearchParams();
        if (kind)
            params.set("kind", kind);
        if (q)
            params.set("q", q);
        appendClampedLimit(params, limit);
        const query = params.toString();
        try {
            const result = await ctx.api.apiJSON("GET", `/api/credentials${query ? `?${query}` : ""}`);
            return ok("Listed credentials.", { items: (result?.items ?? []).map(credentialSummary) });
        }
        catch (e) {
            return fail(String(e));
        }
    });
    server.registerTool("yaaif_credential_create", {
        description: "Create a credential in the platform secret store (admin create defaults to scope tenant_wide). Values are write-only: the result returns key names, never values. Bind it to an MCP server with yaaif_mcp_credential_profile_upsert and yaaif_mcp_credential_mapping_upsert.",
        inputSchema: {
            kind: z.string(),
            display_name: z.string(),
            values: z.record(z.string()),
            scope: z.enum(["tenant_wide", "personal"]).optional(),
            owner_user_id: z.string().optional(),
        },
    }, async ({ kind, display_name, values, scope, owner_user_id }) => {
        try {
            const created = await ctx.api.apiJSON("POST", "/api/credentials", { kind, display_name, values, scope: scope ?? "tenant_wide", ...(owner_user_id ? { owner_user_id } : {}) }, { headers: { "Idempotency-Key": `mcp-credential-create:${randomUUID()}` } });
            return ok(`Created credential ${display_name}.`, { credential: credentialSummary(created) });
        }
        catch (e) {
            return fail(String(e));
        }
    });
    server.registerTool("yaaif_mcp_server_create", {
        description: "Register an external MCP server (STREAMABLE_HTTP or SSE) in the tenant catalog. header_mappings fill HTTP headers from tenant credentials (for example an mcp-http credential's token into X-MCP-Service-Key), so no secret is stored on the server record. Creating the same endpoint again returns the existing server. Then call yaaif_mcp_server_refresh to discover its tools.",
        inputSchema: {
            name: z.string(),
            endpoint: z.string(),
            description: z.string().optional(),
            transport_type: z.enum(["STREAMABLE_HTTP", "SSE"]).optional(),
            header_mappings: z.array(z.object({
                header_name: z.string(),
                credential_id: z.string(),
                credential_key: z.string().optional(),
                value_prefix: z.string().optional(),
            })).optional(),
            timeout_seconds: z.number().int().optional(),
        },
    }, async (args) => {
        try {
            const created = await ctx.api.agentJSON("POST", "/api/mcp-tools/servers", {
                name: args.name,
                description: args.description ?? "",
                endpoint: args.endpoint,
                transport_type: args.transport_type ?? "STREAMABLE_HTTP",
                ...(args.header_mappings ? { header_mappings: args.header_mappings } : {}),
                ...(args.timeout_seconds ? { timeout_seconds: args.timeout_seconds } : {}),
            });
            const { id, name, endpoint, transport_type, header_mappings } = created ?? {};
            return ok(`Registered MCP server ${name ?? args.name}.`, { server: { id, name, endpoint, transport_type, header_mappings } });
        }
        catch (e) {
            return fail(String(e));
        }
    });
    server.registerTool("yaaif_mcp_credential_profiles_list", {
        description: "List credential profiles (connections) on an MCP server: slots, field maps, argument injection and revision.",
        inputSchema: { server_id: z.string() },
    }, async ({ server_id }) => {
        try {
            return ok("Listed credential profiles.", {
                result: await ctx.api.agentJSON("GET", `/api/mcp-tools/servers/${encodeURIComponent(server_id)}/credential-profiles`),
            });
        }
        catch (e) {
            return fail(String(e));
        }
    });
    server.registerTool("yaaif_mcp_credential_profile_upsert", {
        description: "Create or update a credential profile (connection) on an MCP server. credential_bindings define slots (binding_name, credential_kind, field_map credential key -> logical field). arg_injection maps logical fields to tool arguments per full tool name. inject_all_tools applies one {argument: logical_field} map to every tool on the server that declares those arguments. expected_revision defaults to the current revision (0 creates).",
        inputSchema: {
            server_id: z.string(),
            profile_name: z.string(),
            credential_bindings: z.array(bindingSchema),
            arg_injection: argInjectionSchema.optional(),
            inject_all_tools: z.object({ binding: z.string(), args: z.record(z.string()) }).optional(),
            is_default: z.boolean().optional(),
            credential_audience: z.enum(["shared", "personal_ok", "personal_required"]).optional(),
            expected_revision: z.number().int().optional(),
        },
    }, async (args) => {
        const base = `/api/mcp-tools/servers/${encodeURIComponent(args.server_id)}`;
        try {
            let revision = args.expected_revision;
            if (revision === undefined) {
                const current = await ctx.api.agentJSON("GET", `${base}/credential-profiles`);
                revision = (current?.items ?? []).find((p) => p.profile_name === args.profile_name)?.revision ?? 0;
            }
            const injection = { version: 1, bindings: [...(args.arg_injection?.bindings ?? [])] };
            if (args.inject_all_tools) {
                const view = await ctx.api.agentJSON("GET", base);
                const inject = injectAcrossTools(view?.server?.tools ?? view?.tools ?? [], args.inject_all_tools.args);
                if (!Object.keys(inject).length) {
                    return fail("inject_all_tools matched no tool arguments on this server");
                }
                injection.bindings.push({ binding: args.inject_all_tools.binding, inject });
            }
            const profile = await ctx.api.agentJSON("PUT", `${base}/credential-profiles/${encodeURIComponent(args.profile_name)}`, {
                profile_name: args.profile_name,
                credential_bindings: args.credential_bindings,
                arg_injection: injection,
                ...(args.is_default !== undefined ? { is_default: args.is_default } : {}),
                ...(args.credential_audience ? { credential_audience: args.credential_audience } : {}),
            }, { headers: { "If-Match": String(revision) } });
            const toolCount = injection.bindings.reduce((n, b) => n + Object.keys(b.inject).length, 0);
            return ok(`Saved credential profile ${args.profile_name} (${toolCount} tool injection(s)).`, { profile });
        }
        catch (e) {
            return fail(String(e));
        }
    });
    server.registerTool("yaaif_mcp_credential_mappings_list", {
        description: "List credential mappings (which credential fills each profile slot, by scope) for an MCP server.",
        inputSchema: { server_id: z.string() },
    }, async ({ server_id }) => {
        try {
            return ok("Listed credential mappings.", {
                result: await ctx.api.agentJSON("GET", `/api/mcp-tools/servers/${encodeURIComponent(server_id)}/credential-mappings`),
            });
        }
        catch (e) {
            return fail(String(e));
        }
    });
    server.registerTool("yaaif_mcp_credential_mapping_upsert", {
        description: "Map a credential to a profile slot on an MCP server. Empty skill_id and principal_id is the tenant default (needs a tenant_wide credential; used by ambient tool calls). Set skill_id for a skill mapping, principal_id for a personal mapping.",
        inputSchema: {
            server_id: z.string(),
            profile_name: z.string(),
            slot_name: z.string(),
            credential_id: z.string(),
            skill_id: z.string().optional(),
            principal_id: z.string().optional(),
        },
    }, async ({ server_id, profile_name, slot_name, credential_id, skill_id, principal_id }) => {
        try {
            const mapping = await ctx.api.agentJSON("PUT", `/api/mcp-tools/servers/${encodeURIComponent(server_id)}/credential-mappings`, { profile_name, slot_name, credential_id, skill_id: skill_id ?? "", principal_id: principal_id ?? "" });
            return ok(`Mapped credential to ${profile_name}/${slot_name}.`, { mapping });
        }
        catch (e) {
            return fail(String(e));
        }
    });
}
