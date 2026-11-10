import { z } from "zod";
import { appendClampedLimit } from "../lib/catalogLimits.js";
import { fail, ok } from "./helpers.js";
function withPaging(limit, offset) {
    const params = new URLSearchParams();
    appendClampedLimit(params, limit);
    if (offset)
        params.set("offset", String(offset));
    return params;
}
function csv(params, key, values) {
    const normalized = (values ?? []).map((value) => value.trim()).filter(Boolean);
    if (normalized.length)
        params.set(key, normalized.join(","));
}
export function registerWikiTools(server, ctx) {
    server.registerTool("yaaif_wiki_pages_list", {
        description: "Read-only Wiki page search/list with type, lifecycle, confidence and Common/Shared/Mine scope filters. Does not change pages.",
        inputSchema: {
            q: z.string().optional(),
            type: z.array(z.string()).optional(),
            status: z.array(z.string()).optional(),
            scope: z.enum(["common", "shared", "mine"]).optional(),
            min_confidence: z.number().min(0).max(1).optional(),
            sort: z.string().optional(),
            limit: z.number().int().optional(),
            offset: z.number().int().nonnegative().optional(),
        },
    }, async (args) => {
        const params = withPaging(args.limit, args.offset);
        if (args.q)
            params.set("q", args.q);
        if (args.scope)
            params.set("scope", args.scope);
        if (args.min_confidence !== undefined)
            params.set("min_confidence", String(args.min_confidence));
        if (args.sort)
            params.set("sort", args.sort);
        csv(params, "type", args.type);
        csv(params, "status", args.status);
        try {
            return ok("Listed Wiki pages.", { result: await ctx.api.apiJSON("GET", `/api/wiki/pages?${params}`) });
        }
        catch (e) {
            return fail(String(e));
        }
    });
    server.registerTool("yaaif_wiki_page_get", {
        description: "Read one Wiki page with backlinks, outgoing links, sources and versions. Read-only.",
        inputSchema: { slug: z.string() },
    }, async ({ slug }) => {
        try {
            return ok(`Fetched Wiki page ${slug}.`, { page: await ctx.api.apiJSON("GET", `/api/wiki/pages/${encodeURIComponent(slug)}`) });
        }
        catch (e) {
            return fail(String(e));
        }
    });
    server.registerTool("yaaif_wiki_graph", {
        description: "Read the tenant Wiki graph with optional center, hops, relation, skill-link and scope filters. Read-only.",
        inputSchema: {
            center: z.string().optional(),
            hops: z.number().int().min(1).max(3).optional(),
            limit: z.number().int().min(1).max(400).optional(),
            type: z.array(z.string()).optional(),
            rel: z.array(z.string()).optional(),
            skills: z.boolean().optional(),
            scope: z.enum(["common", "shared", "mine"]).optional(),
        },
    }, async (args) => {
        const params = new URLSearchParams();
        if (args.center)
            params.set("center", args.center);
        if (args.hops)
            params.set("hops", String(args.hops));
        if (args.limit)
            params.set("limit", String(args.limit));
        if (args.skills !== undefined)
            params.set("skills", args.skills ? "1" : "0");
        if (args.scope)
            params.set("scope", args.scope);
        csv(params, "type", args.type);
        csv(params, "rel", args.rel);
        try {
            return ok("Fetched Wiki graph.", { graph: await ctx.api.apiJSON("GET", `/api/wiki/graph?${params}`) });
        }
        catch (e) {
            return fail(String(e));
        }
    });
    server.registerTool("yaaif_wiki_common_status", {
        description: "Read Common Wiki distillation status and independently supported shared knowledge. Read-only.",
        inputSchema: {},
    }, async () => {
        try {
            return ok("Fetched Common Wiki status.", { status: await ctx.api.apiJSON("GET", "/api/wiki/common/status") });
        }
        catch (e) {
            return fail(String(e));
        }
    });
    server.registerTool("yaaif_wiki_proposals_list", {
        description: "List Wiki changes held for human review. Inspection only; approvals and rejections stay in Admin UI.",
        inputSchema: { status: z.string().optional(), limit: z.number().int().optional(), offset: z.number().int().nonnegative().optional() },
    }, async ({ status, limit, offset }) => {
        const params = withPaging(limit, offset);
        if (status)
            params.set("status", status);
        try {
            return ok("Listed Wiki proposals.", { result: await ctx.api.apiJSON("GET", `/api/wiki/proposals?${params}`) });
        }
        catch (e) {
            return fail(String(e));
        }
    });
    server.registerTool("yaaif_wiki_proposal_get", {
        description: "Read one Wiki proposal with proposed and current text. Does not approve or reject it.",
        inputSchema: { proposal_id: z.string() },
    }, async ({ proposal_id }) => {
        try {
            return ok(`Fetched Wiki proposal ${proposal_id}.`, { proposal: await ctx.api.apiJSON("GET", `/api/wiki/proposals/${encodeURIComponent(proposal_id)}`) });
        }
        catch (e) {
            return fail(String(e));
        }
    });
    server.registerTool("yaaif_wiki_rebuild_preview", {
        description: "Read what a Wiki rebuild would do. Does not start a rebuild.",
        inputSchema: {},
    }, async () => {
        try {
            return ok("Fetched Wiki rebuild preview.", { preview: await ctx.api.apiJSON("GET", "/api/wiki/rebuild/preview") });
        }
        catch (e) {
            return fail(String(e));
        }
    });
    server.registerTool("yaaif_wiki_rebuild_latest", {
        description: "Read the latest Wiki rebuild run, or no content when none exists. Does not start or cancel a run.",
        inputSchema: {},
    }, async () => {
        try {
            return ok("Fetched latest Wiki rebuild.", { run: await ctx.api.apiJSON("GET", "/api/wiki/rebuild/latest") });
        }
        catch (e) {
            return fail(String(e));
        }
    });
    server.registerTool("yaaif_wiki_rebuild_runs_list", {
        description: "List recent Wiki rebuild runs, newest first. Read-only.",
        inputSchema: { limit: z.number().int().min(1).max(100).optional() },
    }, async ({ limit }) => {
        try {
            return ok("Listed Wiki rebuild runs.", { result: await ctx.api.apiJSON("GET", `/api/wiki/rebuild/runs?limit=${limit ?? 10}`) });
        }
        catch (e) {
            return fail(String(e));
        }
    });
    server.registerTool("yaaif_wiki_rebuild_get", {
        description: "Read one Wiki rebuild run and its activity feed. Does not cancel it.",
        inputSchema: { run_id: z.string() },
    }, async ({ run_id }) => {
        try {
            return ok(`Fetched Wiki rebuild ${run_id}.`, { run: await ctx.api.apiJSON("GET", `/api/wiki/rebuild/runs/${encodeURIComponent(run_id)}`) });
        }
        catch (e) {
            return fail(String(e));
        }
    });
}
