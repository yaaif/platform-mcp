import { z } from "zod";
import { fail, ok } from "./helpers.js";
import { deploymentToUpdateBody, } from "../lib/mcpDeployments.js";
/** Env injected into MCP pods as process-level fallback (matches api-server / pkg/mcpplatformkey). */
export const PLATFORM_API_KEY_ENV = "YAAIF_MCP_PLATFORM_API_KEY";
/** Preferred binding header (avoids clobbering MCP inbound Authorization). */
export const PLATFORM_API_KEY_HEADER = "X-YAAIF-Platform-Key";
const KNOWN_SCOPES = [
    "context_store:read",
    "context_store:write",
    "approvals:read",
    "local_tools:list",
    "local_tools:call",
    "ambient:read",
    "ambient:trigger",
    "skills:read",
    "files:read",
    "files:write",
    "files:share",
];
const allowlistsSchema = z
    .object({
    allowed_mcp_server_ids: z.array(z.string()).optional(),
    allowed_context_plugins: z.array(z.string()).optional(),
    allowed_workflow_ids: z.array(z.string()).optional(),
    allowed_agent_ids: z.array(z.string()).optional(),
})
    .optional();
/**
 * Tenant API keys (ymp-…) for downstream callers (primarily MCP servers) hitting
 * YAAIF platform APIs. Managed via api-server /api/mcp-platform-keys.
 * Never use platform S2S, desktop connection keys, or AI-gateway keys for this.
 */
export function registerApiKeyTools(server, ctx) {
    server.registerTool("yaaif_api_key_list", {
        description: "List tenant API keys (scoped ymp- credentials for MCP/downstream → platform APIs). Returns known scopes vocabulary.",
        inputSchema: {},
    }, async () => {
        try {
            return ok("Listed API keys.", {
                result: await ctx.api.apiJSON("GET", "/api/mcp-platform-keys"),
                known_scopes: KNOWN_SCOPES,
            });
        }
        catch (e) {
            return fail(String(e));
        }
    });
    server.registerTool("yaaif_api_key_get", {
        description: "Get one tenant API key by id (metadata only; plaintext is never retrievable).",
        inputSchema: { key_id: z.string() },
    }, async ({ key_id }) => {
        try {
            return ok("Fetched API key.", {
                key: await ctx.api.apiJSON("GET", `/api/mcp-platform-keys/${encodeURIComponent(key_id)}`),
            });
        }
        catch (e) {
            return fail(String(e));
        }
    });
    server.registerTool("yaaif_api_key_create", {
        description: "Create a scoped API key for MCP/downstream platform access. Plaintext is returned once — bind via yaaif_api_key_bind_deployment or skill field_map; do not inject platform S2S into MCP pods. Prefer least-privilege scopes (e.g. context_store:read/write).",
        inputSchema: {
            name: z.string(),
            scopes: z.array(z.string()).min(1),
            allowlists: allowlistsSchema,
        },
    }, async ({ name, scopes, allowlists }) => {
        try {
            const body = { name, scopes };
            if (allowlists)
                body.allowlists = allowlists;
            const result = await ctx.api.apiJSON("POST", "/api/mcp-platform-keys", body);
            return ok(`Created API key ${name}. Plaintext shown once — bind then discard from chat logs.`, {
                result,
                next_steps: [
                    "Prefer yaaif_api_key_bind_deployment with the credential_id from binding_hints",
                    "Or skill/tool field_map: api_key → headers.X-YAAIF-Platform-Key",
                    "Redeploy MCP after secret_env bind so the pod receives YAAIF_MCP_PLATFORM_API_KEY",
                ],
            });
        }
        catch (e) {
            return fail(String(e));
        }
    });
    server.registerTool("yaaif_api_key_update", {
        description: "Update API key name, scopes, allowlists, or enabled flag.",
        inputSchema: {
            key_id: z.string(),
            name: z.string().optional(),
            scopes: z.array(z.string()).optional(),
            allowlists: allowlistsSchema,
            enabled: z.boolean().optional(),
            clear_expiry: z.boolean().optional(),
        },
    }, async (args) => {
        const body = {};
        if (args.name !== undefined)
            body.name = args.name;
        if (args.scopes !== undefined)
            body.scopes = args.scopes;
        if (args.allowlists !== undefined)
            body.allowlists = args.allowlists;
        if (args.enabled !== undefined)
            body.enabled = args.enabled;
        if (args.clear_expiry)
            body.clear_expiry = true;
        try {
            return ok("Updated API key.", {
                key: await ctx.api.apiJSON("PATCH", `/api/mcp-platform-keys/${encodeURIComponent(args.key_id)}`, body),
            });
        }
        catch (e) {
            return fail(String(e));
        }
    });
    server.registerTool("yaaif_api_key_rotate", {
        description: "Rotate an API key. Keeps the same Credentials credential_id (bindings stay valid). Plaintext returned once; previous hash remains valid for a short grace window.",
        inputSchema: { key_id: z.string() },
    }, async ({ key_id }) => {
        try {
            return ok("Rotated API key. Plaintext shown once.", {
                result: await ctx.api.apiJSON("POST", `/api/mcp-platform-keys/${encodeURIComponent(key_id)}/rotate`, {}),
            });
        }
        catch (e) {
            return fail(String(e));
        }
    });
    server.registerTool("yaaif_api_key_delete", {
        description: "Delete (revoke) an API key and its linked Credentials record when present.",
        inputSchema: { key_id: z.string() },
    }, async ({ key_id }) => {
        try {
            await ctx.api.apiJSON("DELETE", `/api/mcp-platform-keys/${encodeURIComponent(key_id)}`);
            return ok(`Deleted API key ${key_id}.`, { key_id });
        }
        catch (e) {
            return fail(String(e));
        }
    });
    server.registerTool("yaaif_api_key_bind_deployment", {
        description: "Bind an API key Credentials record to an MCP deployment secret_env as YAAIF_MCP_PLATFORM_API_KEY (process fallback for ambient/desktop). Optionally redeploy so the pod picks up the env. Prefer this over putting platform S2S into MCP pods.",
        inputSchema: {
            credential_id: z.string(),
            deployment_id: z.string(),
            env_name: z.string().optional(),
            redeploy: z.boolean().optional(),
        },
    }, async ({ credential_id, deployment_id, env_name, redeploy }) => {
        const envName = (env_name || PLATFORM_API_KEY_ENV).trim() || PLATFORM_API_KEY_ENV;
        const credId = credential_id.trim();
        if (!credId)
            return fail("credential_id is required");
        try {
            const deployment = await ctx.api.apiJSON("GET", `/api/mcp-deployments/${encodeURIComponent(deployment_id)}`);
            if (!deployment?.id && !deployment?.name) {
                return fail(`deployment not found: ${deployment_id}`);
            }
            const nextSecretEnv = [...(deployment.secret_env || [])];
            const mapping = {
                env_name: envName,
                credential_id: credId,
                credential_key: "api_key",
            };
            const existingIndex = nextSecretEnv.findIndex((item) => (item.env_name || "").trim() === envName ||
                (item.env_name || "").trim() === PLATFORM_API_KEY_ENV);
            if (existingIndex >= 0)
                nextSecretEnv[existingIndex] = mapping;
            else
                nextSecretEnv.push(mapping);
            const updated = await ctx.api.apiJSON("PUT", `/api/mcp-deployments/${encodeURIComponent(deployment_id)}`, deploymentToUpdateBody(deployment, { secret_env: nextSecretEnv }));
            let redeployResult;
            if (redeploy) {
                try {
                    redeployResult = await ctx.api.apiJSON("POST", `/api/mcp-deployments/${encodeURIComponent(deployment_id)}/redeploy`, {});
                }
                catch (e) {
                    return ok("Bound secret_env; redeploy failed — fix image/platform and redeploy manually.", {
                        deployment: updated,
                        binding: mapping,
                        field_map_hint: {
                            api_key: `headers.${PLATFORM_API_KEY_HEADER}`,
                        },
                        redeploy_error: String(e),
                    });
                }
            }
            return ok(`Bound ${envName} ← Credentials ${credId} on deployment ${deployment.name || deployment_id}.`, {
                deployment: updated,
                binding: mapping,
                field_map_hint: {
                    api_key: `headers.${PLATFORM_API_KEY_HEADER}`,
                },
                redeployed: Boolean(redeploy),
                redeploy_result: redeployResult,
                note: redeploy
                    ? undefined
                    : "Call yaaif_mcp_deployment_deploy / redeploy so the pod receives the env.",
            });
        }
        catch (e) {
            return fail(String(e));
        }
    });
}
