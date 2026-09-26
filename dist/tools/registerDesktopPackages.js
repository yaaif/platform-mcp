import { z } from "zod";
import { fail, ok } from "./helpers.js";
import { appendClampedLimit } from "../lib/catalogLimits.js";
import { buildToolPackageArchive, inspectCommandMcpCodebase, normalizeToolPackagePlatform, } from "../lib/toolPackageInspect.js";
import { collectWorkerIds, summarizeWorkerPackage, TOOL_INSTALL_DISPATCH_TYPE, TOOL_INSTALL_SKILL_ID, TOOL_REMOVE_DISPATCH_TYPE, TOOL_REMOVE_SKILL_ID, } from "../lib/toolPackageWorker.js";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const inspectFields = {
    source_dir: z.string().describe("Absolute path to a command/stdio MCP codebase."),
    platform: z.enum(["windows", "macos", "linux"]).optional(),
    artifact_path: z.string().optional().describe("Optional prebuilt archive or executable (zip/tar.gz/exe/js)."),
    tool_key: z.string().optional(),
    version: z.string().optional(),
    display_name: z.string().optional(),
    description: z.string().optional(),
    interpreter: z.string().optional(),
    command_args: z.array(z.string()).optional(),
    env_template: z.record(z.string()).optional(),
    capabilities: z.array(z.string()).optional(),
    timeout_seconds: z.number().optional(),
    entrypoint: z.string().optional(),
    git_remote_url: z.string().optional().describe("Optional remote git URL for this package version."),
    git_commit_sha: z.string().optional().describe("Optional git commit SHA for this package version."),
};
function inspectInputFromArgs(args) {
    return inspectCommandMcpCodebase(args);
}
async function listPackages(ctx, q, limit) {
    const params = new URLSearchParams();
    if (q)
        params.set("q", q);
    appendClampedLimit(params, limit);
    const path = `/api/desktop/tool-packages${params.size ? `?${params}` : ""}`;
    return ctx.api.apiJSON("GET", path);
}
async function resolvePackage(ctx, packageIdOrKey) {
    const id = packageIdOrKey.trim();
    if (!id)
        throw new Error("package_id or tool_key is required");
    if (UUID_RE.test(id)) {
        return ctx.api.apiJSON("GET", `/api/desktop/tool-packages/${encodeURIComponent(id)}`);
    }
    const listed = await listPackages(ctx, id, 50);
    const items = Array.isArray(listed.items) ? listed.items : [];
    const exact = items.find((pkg) => String(pkg.tool_key ?? "").toLowerCase() === id.toLowerCase());
    if (exact?.id) {
        return ctx.api.apiJSON("GET", `/api/desktop/tool-packages/${encodeURIComponent(String(exact.id))}`);
    }
    if (items.length === 1 && items[0]?.id) {
        return ctx.api.apiJSON("GET", `/api/desktop/tool-packages/${encodeURIComponent(String(items[0].id))}`);
    }
    throw new Error(`tool package not found: ${id}`);
}
function launchBody(inspected, enabled, provenance) {
    const body = {
        tool_key: inspected.launch.tool_key,
        version: inspected.launch.version,
        display_name: inspected.launch.display_name,
        description: inspected.launch.description,
        interpreter: inspected.launch.interpreter,
        command_args: inspected.launch.command_args,
        env_template: inspected.launch.env_template,
        capabilities: inspected.launch.capabilities,
        timeout_seconds: inspected.launch.timeout_seconds,
    };
    if (enabled !== undefined)
        body.enabled = enabled;
    const gitRemote = provenance?.git_remote_url?.trim() || inspected.launch.git_remote_url?.trim();
    const gitCommit = provenance?.git_commit_sha?.trim() || inspected.launch.git_commit_sha?.trim();
    if (gitRemote)
        body.git_remote_url = gitRemote;
    if (gitCommit)
        body.git_commit_sha = gitCommit;
    return body;
}
async function uploadArtifact(ctx, packageId, inspected) {
    const archive = buildToolPackageArchive(inspected);
    const artifact = await ctx.api.apiForm("POST", `/api/desktop/tool-packages/${encodeURIComponent(packageId)}/artifacts`, {
        platform: archive.platform,
        archive_format: archive.archive_format,
        entrypoint: archive.entrypoint,
    }, {
        filename: archive.file_name,
        body: archive.buffer,
        contentType: archive.content_type,
    });
    return { artifact, archive: { file_name: archive.file_name, size_bytes: archive.buffer.length, file_count: archive.file_count, platform: archive.platform, entrypoint: archive.entrypoint } };
}
async function enqueueWorkerInstall(ctx, args, action) {
    const workerIds = collectWorkerIds(args.worker_id, args.worker_ids);
    if (workerIds.length === 0)
        return fail("worker_id or worker_ids is required");
    const current = await resolvePackage(ctx, args.package_id);
    const jobs = [];
    for (const worker_id of workerIds) {
        const body = { worker_id };
        if (args.platform)
            body.platform = args.platform;
        const result = await ctx.api.controlPlaneJSON("POST", `/api/desktop/tool-packages/${encodeURIComponent(String(current.id))}/install`, body);
        jobs.push({ worker_id, result });
    }
    const verb = action === "upgrade" ? "upgrade" : "install";
    return ok(`Queued ${verb} of ${current.tool_key || current.id} on ${jobs.length} worker(s).`, { action, package: current, jobs });
}
async function listDesktopRuns(ctx, query) {
    const params = new URLSearchParams({
        skill_id: query.skill_id,
        dispatch_type: query.dispatch_type,
        include_filter_options: "false",
        limit: String(query.limit),
    });
    if (query.worker_id)
        params.set("worker_id", query.worker_id);
    const page = await ctx.api.controlPlaneJSON("GET", `/api/desktop/runs?${params}`);
    return Array.isArray(page.items) ? page.items : [];
}
/**
 * Desktop Package Registry for command/stdio MCP servers (Admin UI Catalog → Desktop tools).
 * HTTP MCP servers still use yaaif_mcp_deployment_*.
 */
export function registerDesktopPackageTools(server, ctx) {
    server.registerTool("yaaif_desktop_tool_packages_list", {
        description: "List command-based MCP tool packages in the tenant Package Registry (api-server /api/desktop/tool-packages).",
        inputSchema: { q: z.string().optional(), limit: z.number().optional() },
    }, async ({ q, limit }) => {
        try {
            return ok("Listed desktop tool packages.", { result: await listPackages(ctx, q, limit) });
        }
        catch (e) {
            return fail(String(e));
        }
    });
    server.registerTool("yaaif_desktop_tool_package_get", {
        description: "Get one desktop tool package by id (UUID) or tool_key (e.g. sap-gui.mcp).",
        inputSchema: { package_id: z.string() },
    }, async ({ package_id }) => {
        try {
            return ok("Fetched desktop tool package.", { package: await resolvePackage(ctx, package_id) });
        }
        catch (e) {
            return fail(String(e));
        }
    });
    server.registerTool("yaaif_desktop_tool_package_inspect", {
        description: "Inspect a local command/stdio MCP codebase and propose Package Registry metadata + archive plan. Does not upload. Reads optional yaaif-tool-package.json.",
        inputSchema: inspectFields,
    }, async (args) => {
        try {
            const inspected = inspectInputFromArgs(args);
            return ok(`Inspected command MCP at ${inspected.source_dir}.`, { inspected });
        }
        catch (e) {
            return fail(String(e));
        }
    });
    server.registerTool("yaaif_desktop_tool_package_publish", {
        description: "Add or update a Package Registry entry from a local command/stdio MCP codebase: infer launch contract, zip source or wrap dist exe, create/update the package, upload the platform artifact. Use mode=add (fail if exists), update (fail if missing), or upsert (default).",
        inputSchema: {
            ...inspectFields,
            mode: z.enum(["add", "update", "upsert"]).optional(),
            package_id: z.string().optional().describe("Existing package UUID or tool_key when mode=update."),
            enabled: z.boolean().optional(),
            skip_artifact: z.boolean().optional().describe("Update metadata only; do not zip/upload an archive."),
        },
    }, async (args) => {
        try {
            const mode = args.mode || "upsert";
            const inspected = inspectInputFromArgs(args);
            if (!normalizeToolPackagePlatform(inspected.artifact.platform)) {
                return fail("platform must be windows, macos, or linux");
            }
            let existing = null;
            if (args.package_id) {
                existing = await resolvePackage(ctx, args.package_id);
            }
            else {
                try {
                    existing = await resolvePackage(ctx, inspected.launch.tool_key);
                }
                catch {
                    existing = null;
                }
            }
            if (mode === "add" && existing?.id) {
                return fail(`package already exists for tool_key ${inspected.launch.tool_key} (${existing.id})`);
            }
            if (mode === "update" && !existing?.id) {
                return fail(`package not found for update: ${args.package_id || inspected.launch.tool_key}`);
            }
            let pkg;
            let action;
            if (existing?.id) {
                const body = launchBody(inspected, args.enabled);
                delete body.tool_key;
                pkg = await ctx.api.apiJSON("PUT", `/api/desktop/tool-packages/${encodeURIComponent(String(existing.id))}`, body);
                action = "updated";
            }
            else {
                pkg = await ctx.api.apiJSON("POST", "/api/desktop/tool-packages", launchBody(inspected, args.enabled));
                action = "created";
            }
            const packageId = String(pkg.id || existing?.id || "");
            let uploaded;
            if (!args.skip_artifact) {
                uploaded = await uploadArtifact(ctx, packageId, inspected);
            }
            const refreshed = packageId
                ? await ctx.api.apiJSON("GET", `/api/desktop/tool-packages/${encodeURIComponent(packageId)}`)
                : pkg;
            return ok(action === "created"
                ? `Created desktop tool package ${inspected.launch.tool_key}.`
                : `Updated desktop tool package ${inspected.launch.tool_key}.`, {
                action,
                package: refreshed,
                inspected,
                upload: uploaded,
                warnings: inspected.warnings,
            });
        }
        catch (e) {
            return fail(String(e));
        }
    });
    server.registerTool("yaaif_desktop_tool_package_update", {
        description: "Update Package Registry metadata for an existing command MCP package (no local codebase required). To refresh the archive from source, use yaaif_desktop_tool_package_publish mode=update.",
        inputSchema: {
            package_id: z.string(),
            version: z.string().optional(),
            display_name: z.string().optional(),
            description: z.string().optional(),
            interpreter: z.string().optional(),
            command_args: z.array(z.string()).optional(),
            env_template: z.record(z.string()).optional(),
            capabilities: z.array(z.string()).optional(),
            timeout_seconds: z.number().optional(),
            enabled: z.boolean().optional(),
            git_remote_url: z.string().optional(),
            git_commit_sha: z.string().optional(),
        },
    }, async (args) => {
        try {
            const current = await resolvePackage(ctx, args.package_id);
            const body = {};
            if (args.version !== undefined)
                body.version = args.version;
            if (args.display_name !== undefined)
                body.display_name = args.display_name;
            if (args.description !== undefined)
                body.description = args.description;
            if (args.interpreter !== undefined)
                body.interpreter = args.interpreter;
            if (args.command_args !== undefined)
                body.command_args = args.command_args;
            if (args.env_template !== undefined)
                body.env_template = args.env_template;
            if (args.capabilities !== undefined)
                body.capabilities = args.capabilities;
            if (args.timeout_seconds !== undefined)
                body.timeout_seconds = args.timeout_seconds;
            if (args.enabled !== undefined)
                body.enabled = args.enabled;
            if (args.git_remote_url !== undefined)
                body.git_remote_url = args.git_remote_url;
            if (args.git_commit_sha !== undefined)
                body.git_commit_sha = args.git_commit_sha;
            if (Object.keys(body).length === 0)
                return fail("No fields to update");
            const pkg = await ctx.api.apiJSON("PUT", `/api/desktop/tool-packages/${encodeURIComponent(String(current.id))}`, body);
            return ok(`Updated desktop tool package ${current.tool_key || current.id}.`, { package: pkg });
        }
        catch (e) {
            return fail(String(e));
        }
    });
    server.registerTool("yaaif_desktop_tool_package_delete", {
        description: "Remove a command-based MCP tool package (and its platform archives) from the Package Registry.",
        inputSchema: { package_id: z.string().describe("Package UUID or tool_key.") },
    }, async ({ package_id }) => {
        try {
            const current = await resolvePackage(ctx, package_id);
            await ctx.api.apiJSON("DELETE", `/api/desktop/tool-packages/${encodeURIComponent(String(current.id))}`);
            return ok(`Deleted desktop tool package ${current.tool_key || current.id}.`, {
                package_id: current.id,
                tool_key: current.tool_key,
                deleted: true,
            });
        }
        catch (e) {
            return fail(String(e));
        }
    });
    server.registerTool("yaaif_desktop_tool_package_install", {
        description: "Install or reinstall a Package Registry archive onto one or more desktop workers (control-plane POST .../install). Re-running on a worker that already has the tool upgrades it to the current package version. Platform is optional — control-plane uses the worker's OS when omitted.",
        inputSchema: {
            package_id: z.string().describe("Package UUID or tool_key."),
            worker_id: z.string().optional(),
            worker_ids: z.array(z.string()).optional(),
            platform: z.enum(["windows", "macos", "linux"]).optional(),
        },
    }, async (args) => {
        try {
            return await enqueueWorkerInstall(ctx, args, "install");
        }
        catch (e) {
            return fail(String(e));
        }
    });
    server.registerTool("yaaif_desktop_tool_package_upgrade", {
        description: "Upgrade a command MCP already installed on desktop worker(s) to the current Package Registry version. Same control-plane install dispatch as yaaif_desktop_tool_package_install (worker upserts the local tool).",
        inputSchema: {
            package_id: z.string().describe("Package UUID or tool_key."),
            worker_id: z.string().optional(),
            worker_ids: z.array(z.string()).optional(),
            platform: z.enum(["windows", "macos", "linux"]).optional(),
        },
    }, async (args) => {
        try {
            return await enqueueWorkerInstall(ctx, args, "upgrade");
        }
        catch (e) {
            return fail(String(e));
        }
    });
    server.registerTool("yaaif_desktop_tool_package_uninstall", {
        description: "Remove an installed command MCP from desktop worker(s) (control-plane POST .../remove). Does not delete the Package Registry entry — use yaaif_desktop_tool_package_delete for that.",
        inputSchema: {
            package_id: z.string().describe("Package UUID or tool_key."),
            worker_id: z.string().optional(),
            worker_ids: z.array(z.string()).optional(),
            tool_key: z.string().optional().describe("Defaults to the package tool_key."),
            version: z.string().optional(),
        },
    }, async (args) => {
        try {
            const workerIds = collectWorkerIds(args.worker_id, args.worker_ids);
            if (workerIds.length === 0)
                return fail("worker_id or worker_ids is required");
            const current = await resolvePackage(ctx, args.package_id);
            const toolKey = (args.tool_key || String(current.tool_key ?? "")).trim();
            if (!toolKey)
                return fail("tool_key is required");
            const jobs = [];
            for (const worker_id of workerIds) {
                const body = { worker_id, tool_key: toolKey };
                if (args.version)
                    body.version = args.version;
                const result = await ctx.api.controlPlaneJSON("POST", `/api/desktop/tool-packages/${encodeURIComponent(String(current.id))}/remove`, body);
                jobs.push({ worker_id, result });
            }
            return ok(`Queued uninstall of ${toolKey} from ${jobs.length} worker(s).`, { action: "uninstall", package: current, jobs });
        }
        catch (e) {
            return fail(String(e));
        }
    });
    server.registerTool("yaaif_desktop_tool_package_worker_status", {
        description: "Show install/upgrade/remove state of a Package Registry tool on desktop workers (from control-plane tool_install and tool_remove runs). Use before install or uninstall.",
        inputSchema: {
            package_id: z.string().describe("Package UUID or tool_key."),
            worker_id: z.string().optional(),
            worker_ids: z.array(z.string()).optional(),
            limit: z.number().optional(),
        },
    }, async (args) => {
        try {
            const current = await resolvePackage(ctx, args.package_id);
            const packageId = String(current.id ?? "");
            const toolKey = String(current.tool_key ?? "");
            const requested = collectWorkerIds(args.worker_id, args.worker_ids);
            const workersPage = await ctx.api.controlPlaneJSON("GET", "/api/desktop/workers?limit=200");
            const workers = (workersPage.items ?? []).filter((w) => {
                const id = String(w.id ?? "").trim();
                return id && (requested.length === 0 || requested.includes(id));
            });
            const runLimit = Math.max(1, Math.min(args.limit ?? 100, 200));
            const [installRuns, removeRuns] = await Promise.all([
                listDesktopRuns(ctx, {
                    skill_id: TOOL_INSTALL_SKILL_ID,
                    dispatch_type: TOOL_INSTALL_DISPATCH_TYPE,
                    worker_id: requested.length === 1 ? requested[0] : undefined,
                    limit: runLimit,
                }),
                listDesktopRuns(ctx, {
                    skill_id: TOOL_REMOVE_SKILL_ID,
                    dispatch_type: TOOL_REMOVE_DISPATCH_TYPE,
                    worker_id: requested.length === 1 ? requested[0] : undefined,
                    limit: runLimit,
                }),
            ]);
            const runs = [...installRuns, ...removeRuns];
            const workers_status = workers.map((w) => ({
                ...summarizeWorkerPackage(String(w.id), runs, packageId, toolKey, String(current.version ?? "")),
                platform: w.platform ?? "",
                name: w.display_name || w.name || w.id,
                last_seen_at: w.last_seen_at ?? "",
            }));
            return ok(`Worker status for ${toolKey || packageId}.`, {
                package: { id: current.id, tool_key: current.tool_key, version: current.version },
                workers: workers_status,
            });
        }
        catch (e) {
            return fail(String(e));
        }
    });
}
