import { z } from "zod";
import { fail, ok } from "./helpers.js";
import { appendClampedLimit } from "../lib/catalogLimits.js";
function normalizeRole(value) {
    return value.trim().toUpperCase();
}
async function resolveTenantUser(ctx, user_id, email) {
    const id = (user_id ?? "").trim();
    if (id) {
        return ctx.api.apiJSON("GET", `/api/users/${encodeURIComponent(id)}`);
    }
    const wantEmail = (email ?? "").trim().toLowerCase();
    if (!wantEmail) {
        throw new Error("user_id or email is required");
    }
    const params = new URLSearchParams({ q: wantEmail });
    appendClampedLimit(params, 20);
    const page = await ctx.api.apiJSON("GET", `/api/users?${params}`);
    const match = (page.items ?? []).find((item) => String(item.email ?? "").trim().toLowerCase() === wantEmail);
    if (!match?.id) {
        throw new Error(`user not found: ${wantEmail}`);
    }
    return match;
}
export function registerUserTools(server, ctx) {
    server.registerTool("yaaif_roles_list", {
        description: "List tenant RBAC role names (ADMIN, EDITOR, DEVELOPER, VIEWER, CHAT_USER, plus custom roles). Requires users:read.",
        inputSchema: {},
    }, async () => {
        try {
            return ok("Listed roles.", { result: await ctx.api.apiJSON("GET", "/api/roles") });
        }
        catch (e) {
            return fail(String(e));
        }
    });
    server.registerTool("yaaif_user_list", {
        description: "List tenant users (name, email, role, active). Requires users:read. Admins use this before yaaif_user_role_set.",
        inputSchema: {
            q: z.string().optional(),
            limit: z.number().optional(),
            active: z.boolean().optional(),
        },
    }, async ({ q, limit, active }) => {
        const params = new URLSearchParams();
        if (q)
            params.set("q", q);
        appendClampedLimit(params, limit);
        if (typeof active === "boolean")
            params.set("active", String(active));
        const path = `/api/users${params.size ? `?${params}` : ""}`;
        try {
            return ok("Listed users.", { result: await ctx.api.apiJSON("GET", path) });
        }
        catch (e) {
            return fail(String(e));
        }
    });
    server.registerTool("yaaif_user_get", {
        description: "Get one tenant user by id or email. Requires users:read.",
        inputSchema: {
            user_id: z.string().optional(),
            email: z.string().optional(),
        },
    }, async ({ user_id, email }) => {
        try {
            const user = await resolveTenantUser(ctx, user_id, email);
            return ok("Fetched user.", { user });
        }
        catch (e) {
            return fail(String(e));
        }
    });
    server.registerTool("yaaif_user_role_set", {
        description: "Change a tenant user's platform role (ADMIN, EDITOR, DEVELOPER, VIEWER, CHAT_USER, or a custom role from yaaif_roles_list). Requires users:write. Granting ADMIN additionally requires the caller to be ADMIN and confirm_admin_grant=true.",
        inputSchema: {
            user_id: z.string().optional(),
            email: z.string().optional(),
            role: z.string(),
            confirm_admin_grant: z.boolean().optional(),
        },
    }, async ({ user_id, email, role, confirm_admin_grant }) => {
        const targetRole = normalizeRole(role);
        if (!targetRole) {
            return fail("role is required");
        }
        if (targetRole === "ADMIN" && !confirm_admin_grant) {
            return fail("Granting ADMIN requires confirm_admin_grant=true (caller must already be ADMIN).");
        }
        try {
            let current = { id: (user_id ?? "").trim() };
            if (current.id) {
                try {
                    current = await resolveTenantUser(ctx, current.id, undefined);
                }
                catch {
                    // Older api-servers may lack GET /api/users/:id; PUT still applies the role.
                }
            }
            else {
                current = await resolveTenantUser(ctx, undefined, email);
            }
            const id = String(current.id ?? "").trim();
            if (!id) {
                return fail("resolved user is missing id");
            }
            const previousRole = normalizeRole(String(current.role ?? ""));
            if (previousRole === targetRole) {
                return ok(`User already has role ${targetRole}.`, { user: current, unchanged: true });
            }
            const user = await ctx.api.apiJSON("PUT", `/api/users/${encodeURIComponent(id)}`, { role: targetRole });
            return ok(`Updated role for ${user.email ?? id} from ${previousRole || "unknown"} to ${targetRole}.`, {
                user,
                previous_role: previousRole || null,
            });
        }
        catch (e) {
            return fail(String(e));
        }
    });
}
