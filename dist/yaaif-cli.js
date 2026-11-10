#!/usr/bin/env node
import { resolve } from "node:path";
import { installTlsDispatcher } from "./client/tls.js";
import { CLI_CLIENT } from "./config.js";
import { optionalNumber, parseArgs, readToolArguments, required } from "./cli/args.js";
import { HELP } from "./cli/help.js";
import { completionScript } from "./cli/completion.js";
import { callTool, listTools, openCliMcp } from "./cli/mcp.js";
import { printData, printToolResult } from "./cli/output.js";
import { checkPlugin, installOrUpdatePlugin, PLUGIN_CLIENTS, pluginCatalog } from "./cli/plugins.js";
import { applyProfileToConfig, profileFromPlatformUrl } from "./platform/profiles.js";
import { createProfileBundle, readProfileBundle, writeProfileBundle } from "./lib/profileBundle.js";
import { PACKAGE_VERSION } from "./version.js";
async function withMcp(fn) {
    const mcp = await openCliMcp();
    try {
        return await fn(mcp);
    }
    finally {
        await mcp.close();
    }
}
async function invoke(mcp, name, args, global) {
    return printToolResult(await callTool(mcp.client, name, args), global.json, global.table);
}
function commonCatalogArgs(args) {
    return {
        ...(args.values.get("--q") ? { q: args.values.get("--q") } : {}),
        ...(args.values.get("--status") ? { status: args.values.get("--status") } : {}),
        ...(optionalNumber(args.values.get("--limit"), "--limit") ? { limit: optionalNumber(args.values.get("--limit"), "--limit") } : {}),
    };
}
async function runTools(argv, global) {
    const action = argv[0];
    if (action === "list") {
        const filter = argv[1]?.toLowerCase() ?? "";
        return await withMcp(async (mcp) => {
            const tools = (await listTools(mcp.client)).filter((tool) => !filter || tool.name.toLowerCase().includes(filter) || tool.description?.toLowerCase().includes(filter));
            if (global.json)
                printData(tools.map((tool) => ({ name: tool.name, description: tool.description })), true);
            else
                process.stdout.write(`${tools.map((tool) => `${tool.name}\t${tool.description ?? ""}`).join("\n")}\n`);
            return 0;
        });
    }
    if (action === "describe") {
        const name = required(argv[1], "usage: yaaif tools describe TOOL");
        return await withMcp(async (mcp) => {
            const tool = (await listTools(mcp.client)).find((candidate) => candidate.name === name);
            if (!tool)
                throw new Error(`unknown YAAIF tool: ${name}; run yaaif tools list`);
            printData(tool, global.json);
            return 0;
        });
    }
    if (action === "call") {
        const name = required(argv[1], "usage: yaaif tools call TOOL [--args JSON|@FILE|-]");
        const args = parseArgs(argv.slice(2), { strings: ["--args"] });
        if (args.positionals.length)
            throw new Error(`unexpected argument: ${args.positionals[0]}`);
        const input = await readToolArguments(args.values.get("--args"));
        return await withMcp(async (mcp) => await invoke(mcp, name, input, global));
    }
    throw new Error("usage: yaaif tools list|describe|call");
}
async function runSession(command, argv, global) {
    return await withMcp(async (mcp) => {
        if (command === "whoami")
            return await invoke(mcp, "yaaif_whoami", {}, global);
        if (command === "features")
            return await invoke(mcp, "yaaif_features", {}, global);
        if (command === "doctor") {
            const args = parseArgs(argv, { booleans: ["--login"] });
            return await invoke(mcp, "yaaif_doctor", { login_if_needed: args.flags.has("--login") }, global);
        }
        if (command === "auth") {
            const action = argv[0];
            if (action === "login") {
                const args = parseArgs(argv.slice(1), { booleans: ["--device"] });
                return args.flags.has("--device")
                    ? await invoke(mcp, "yaaif_login_device", { wait: true }, global)
                    : await invoke(mcp, "yaaif_login", {}, global);
            }
            if (action === "status")
                return await invoke(mcp, "yaaif_whoami", {}, global);
            if (action === "logout") {
                const args = parseArgs(argv.slice(1), { booleans: ["--end-session"] });
                return await invoke(mcp, "yaaif_logout", { end_session: args.flags.has("--end-session") }, global);
            }
            throw new Error("usage: yaaif auth login|status|logout");
        }
        if (command === "profile") {
            const action = argv[0];
            if (action === "list")
                return await invoke(mcp, "yaaif_platform_list", {}, global);
            if (action === "export") {
                const args = parseArgs(argv.slice(1), { strings: ["--out"] });
                const output = args.values.get("--out");
                if (!output)
                    return await invoke(mcp, "yaaif_platform_export", {}, global);
                const protectedPaths = new Set([
                    mcp.runtime.profiles.customPath,
                    mcp.runtime.profiles.activePath,
                    mcp.runtime.store.path,
                ].map((path) => resolve(path)));
                if (protectedPaths.has(resolve(output)))
                    throw new Error("refusing to overwrite live profile or session state; choose a different --out path");
                const profiles = await mcp.runtime.profiles.listAll();
                const active = await mcp.runtime.profiles.getActive();
                const bundle = createProfileBundle(profiles, active?.profile_id);
                await writeProfileBundle(output, bundle);
                printData({ path: output, profile_count: profiles.length, sessions_copied: false }, global.json);
                return 0;
            }
            if (action === "import") {
                const path = required(argv[1], "profile bundle path is required");
                const args = parseArgs(argv.slice(2), { strings: ["--activate"], booleans: ["--yes"] });
                const bundle = await readProfileBundle(path);
                return await invoke(mcp, "yaaif_platform_bundle_import", {
                    document: bundle,
                    activate: args.values.get("--activate"),
                    dry_run: !args.flags.has("--yes"),
                    confirm: args.flags.has("--yes"),
                }, global);
            }
            if (action === "use")
                return await invoke(mcp, "yaaif_platform_use", { profile_id: required(argv[1], "profile id is required") }, global);
            if (action === "clone") {
                const source = required(argv[1], "source profile id is required");
                const destination = required(argv[2], "destination profile id is required");
                const args = parseArgs(argv.slice(3), { strings: ["--label"], booleans: ["--activate"] });
                return await invoke(mcp, "yaaif_platform_clone", {
                    source_profile_id: source,
                    destination_profile_id: destination,
                    label: args.values.get("--label"),
                    activate: args.flags.has("--activate"),
                }, global);
            }
            if (action === "delete") {
                const id = required(argv[1], "profile id is required");
                const deleted = await mcp.runtime.profiles.deleteCustom(id);
                if (!deleted)
                    throw new Error(`custom profile not found: ${id}`);
                printData({ deleted: true, profile_id: id }, global.json);
                return 0;
            }
            if (action === "save") {
                const id = required(argv[1], "profile id is required");
                const args = parseArgs(argv.slice(2), { strings: ["--yaaif-url", "--oidc-authority"] });
                const profile = profileFromPlatformUrl(required(args.values.get("--yaaif-url"), "--yaaif-url is required"), CLI_CLIENT.oidcClientId);
                if (args.values.get("--oidc-authority"))
                    profile.oidc_authority = args.values.get("--oidc-authority");
                profile.id = id.toLowerCase();
                profile.label = id;
                return await invoke(mcp, "yaaif_platform_save", {
                    id: profile.id,
                    label: profile.label,
                    oidc_authority: profile.oidc_authority,
                    api_base_url: profile.api_base_url,
                    agent_base_url: profile.agent_base_url,
                    control_plane_base_url: profile.control_plane_base_url,
                    approval_base_url: profile.approval_base_url,
                    oidc_client_id: profile.oidc_client_id,
                }, global);
            }
            throw new Error("usage: yaaif profile list|use|save|delete|export");
        }
        if (command === "tenant") {
            const action = argv[0];
            if (action === "list")
                return await invoke(mcp, "yaaif_list_tenants", {}, global);
            if (action === "use")
                return await invoke(mcp, "yaaif_set_tenant", { tenant: required(argv[1], "tenant is required") }, global);
            throw new Error("usage: yaaif tenant list|use");
        }
        if (command === "setup") {
            const args = parseArgs(argv, { strings: ["--yaaif-url", "--profile"], booleans: ["--device", "--no-login"] });
            const url = args.values.get("--yaaif-url");
            const profileId = args.values.get("--profile");
            if (url && profileId)
                throw new Error("use only one of --yaaif-url and --profile");
            let selected = profileId || "hosted";
            if (url) {
                const profile = profileFromPlatformUrl(url, CLI_CLIENT.oidcClientId);
                if (!profile.builtin)
                    await mcp.runtime.profiles.upsertCustom(profile);
                selected = profile.id;
            }
            const profile = await mcp.runtime.profiles.get(selected);
            if (!profile)
                throw new Error(`unknown profile: ${selected}`);
            await mcp.runtime.profiles.setActive(profile.id);
            applyProfileToConfig(mcp.runtime.cfg, profile);
            installTlsDispatcher(mcp.runtime.cfg);
            if (args.flags.has("--no-login")) {
                printData({ profile_id: profile.id, login: "skipped" }, global.json);
                return 0;
            }
            return args.flags.has("--device")
                ? await invoke(mcp, "yaaif_login_device", { wait: true }, global)
                : await invoke(mcp, "yaaif_login", {}, global);
        }
        throw new Error(`unknown session command: ${command}`);
    });
}
async function runCatalog(command, argv, global) {
    if (command === "catalog" && argv[0] === "overview") {
        return await withMcp(async (mcp) => await invoke(mcp, "yaaif_catalog_overview", {}, global));
    }
    const action = argv[0];
    const args = parseArgs(argv.slice(1), { strings: ["--q", "--status", "--limit", "--agent-type"] });
    let tool = "";
    const toolArgs = commonCatalogArgs(args);
    if (command === "agents")
        tool = action === "get" ? "yaaif_agent_get" : "yaaif_agent_list";
    if (command === "skills")
        tool = action === "get" ? "yaaif_skill_get" : "yaaif_skill_list";
    if (command === "specs")
        tool = action === "get" ? "yaaif_agent_spec_get" : "yaaif_agent_spec_list";
    if (command === "mcp") {
        const resource = action;
        const verb = argv[1];
        if (verb !== "list")
            throw new Error("usage: yaaif mcp servers|tools|deployments list");
        tool = resource === "servers" ? "yaaif_mcp_servers_list" : resource === "tools" ? "yaaif_mcp_tools_list" : resource === "deployments" ? "yaaif_mcp_deployments_list" : "";
        Object.assign(toolArgs, commonCatalogArgs(parseArgs(argv.slice(2), { strings: ["--q", "--limit"] })));
    }
    if (command === "ambient") {
        const resource = action;
        const verb = argv[1];
        if (verb !== "list")
            throw new Error("usage: yaaif ambient agents|workflows|runs list");
        tool = resource === "agents" ? "yaaif_ambient_agent_list" : resource === "workflows" ? "yaaif_ambient_workflow_list" : resource === "runs" ? "yaaif_ambient_runs_list" : "";
        Object.assign(toolArgs, commonCatalogArgs(parseArgs(argv.slice(2), { strings: ["--q", "--status", "--limit"] })));
    }
    if (command === "approvals" && action === "strategies" && argv[1] === "list")
        tool = "yaaif_approval_strategies_list";
    if (!tool || (!["mcp", "ambient", "approvals"].includes(command) && !["list", "get"].includes(action))) {
        throw new Error(`invalid catalog command: ${command} ${argv.join(" ")}`);
    }
    if (action === "get") {
        const id = required(args.positionals[0], `${command} id is required`);
        if (command === "agents")
            toolArgs.agent_id = id;
        if (command === "skills")
            toolArgs.skill_id = id;
        if (command === "specs")
            toolArgs.spec_id = id;
    }
    if (command === "agents" && args.values.get("--agent-type"))
        toolArgs.agent_type = args.values.get("--agent-type");
    return await withMcp(async (mcp) => await invoke(mcp, tool, toolArgs, global));
}
async function runKnowledge(command, argv, global) {
    return await withMcp(async (mcp) => {
        if (command === "updates") {
            if (argv[0] === "status")
                return await invoke(mcp, "yaaif_platform_update_status", {}, global);
            if (argv[0] === "jobs" && argv[1] === "list") {
                const args = parseArgs(argv.slice(2), { strings: ["--limit"] });
                return await invoke(mcp, "yaaif_platform_update_jobs_list", { limit: optionalNumber(args.values.get("--limit"), "--limit") }, global);
            }
            if (argv[0] === "jobs" && argv[1] === "get") {
                return await invoke(mcp, "yaaif_platform_update_job_get", { job_id: required(argv[2], "job id is required") }, global);
            }
            throw new Error("usage: yaaif updates status | jobs list | jobs get ID");
        }
        const action = argv[0];
        if (action === "search") {
            const args = parseArgs(argv.slice(1), { strings: ["--type", "--status", "--scope", "--limit"] });
            return await invoke(mcp, "yaaif_wiki_pages_list", {
                q: args.positionals.join(" ") || undefined,
                type: args.values.get("--type")?.split(","),
                status: args.values.get("--status")?.split(","),
                scope: args.values.get("--scope"),
                limit: optionalNumber(args.values.get("--limit"), "--limit"),
            }, global);
        }
        if (action === "get")
            return await invoke(mcp, "yaaif_wiki_page_get", { slug: required(argv[1], "Wiki slug is required") }, global);
        if (action === "graph") {
            const args = parseArgs(argv.slice(1), { strings: ["--center", "--hops", "--limit", "--scope"], booleans: ["--skills"] });
            return await invoke(mcp, "yaaif_wiki_graph", {
                center: args.values.get("--center"),
                hops: optionalNumber(args.values.get("--hops"), "--hops"),
                limit: optionalNumber(args.values.get("--limit"), "--limit"),
                scope: args.values.get("--scope"),
                skills: args.flags.has("--skills") || undefined,
            }, global);
        }
        if (action === "common")
            return await invoke(mcp, "yaaif_wiki_common_status", {}, global);
        if (action === "proposals" && argv[1] === "list") {
            const args = parseArgs(argv.slice(2), { strings: ["--status", "--limit"] });
            return await invoke(mcp, "yaaif_wiki_proposals_list", { status: args.values.get("--status"), limit: optionalNumber(args.values.get("--limit"), "--limit") }, global);
        }
        if (action === "proposals" && argv[1] === "get")
            return await invoke(mcp, "yaaif_wiki_proposal_get", { proposal_id: required(argv[2], "proposal id is required") }, global);
        if (action === "rebuilds" && argv[1] === "preview")
            return await invoke(mcp, "yaaif_wiki_rebuild_preview", {}, global);
        if (action === "rebuilds" && argv[1] === "latest")
            return await invoke(mcp, "yaaif_wiki_rebuild_latest", {}, global);
        if (action === "rebuilds" && argv[1] === "list") {
            const args = parseArgs(argv.slice(2), { strings: ["--limit"] });
            return await invoke(mcp, "yaaif_wiki_rebuild_runs_list", { limit: optionalNumber(args.values.get("--limit"), "--limit") }, global);
        }
        if (action === "rebuilds" && argv[1] === "get")
            return await invoke(mcp, "yaaif_wiki_rebuild_get", { run_id: required(argv[2], "rebuild run id is required") }, global);
        throw new Error("usage: yaaif wiki search|get|graph|common|proposals|rebuilds");
    });
}
async function runCopy(argv, global) {
    const resource = argv[0];
    const specId = required(argv[1], `${resource === "skill" ? "skill" : "Scenario"} id is required`);
    const args = parseArgs(argv.slice(2), {
        strings: ["--from", "--to", "--new-slug", "--new-id", "--new-name", "--new-endpoint", "--ambient-agent-id", "--workflow-agent-id", "--agents", "--ambient-agents", "--workflows", "--mcp-servers", "--skills", "--scenarios", "--revision"],
        booleans: ["--dry-run", "--yes"],
    });
    if (args.flags.has("--dry-run") && args.flags.has("--yes"))
        throw new Error("use only one of --dry-run and --yes");
    const source = required(args.values.get("--from"), "--from source profile is required");
    const destination = required(args.values.get("--to"), "--to destination profile is required");
    const revision = optionalNumber(args.values.get("--revision"), "--revision");
    if (resource === "catalog") {
        const list = (name) => args.values.get(name)?.split(",").map((value) => value.trim()).filter(Boolean);
        return await withMcp(async (mcp) => await invoke(mcp, "yaaif_catalog_copy", {
            source_profile_id: source,
            destination_profile_id: destination,
            mcp_servers: list("--mcp-servers"),
            skills: list("--skills"),
            agents: list("--agents"),
            ambient_agents: list("--ambient-agents"),
            workflows: list("--workflows"),
            scenarios: list("--scenarios"),
            workflow_agent_id: args.values.get("--workflow-agent-id"),
            ambient_agent_id: args.values.get("--ambient-agent-id"),
            dry_run: !args.flags.has("--yes"),
            confirm: args.flags.has("--yes"),
        }, global));
    }
    if (resource === "agent") {
        return await withMcp(async (mcp) => await invoke(mcp, "yaaif_agent_copy", {
            source_profile_id: source,
            destination_profile_id: destination,
            agent_id: specId,
            new_name: args.values.get("--new-name"),
            dry_run: !args.flags.has("--yes"),
            confirm: args.flags.has("--yes"),
        }, global));
    }
    if (resource === "mcp-server") {
        return await withMcp(async (mcp) => await invoke(mcp, "yaaif_mcp_server_copy", {
            source_profile_id: source,
            destination_profile_id: destination,
            server_id: specId,
            new_name: args.values.get("--new-name"),
            new_endpoint: args.values.get("--new-endpoint"),
            dry_run: !args.flags.has("--yes"),
            confirm: args.flags.has("--yes"),
        }, global));
    }
    if (resource === "workflow") {
        return await withMcp(async (mcp) => await invoke(mcp, "yaaif_ambient_workflow_copy", {
            source_profile_id: source,
            destination_profile_id: destination,
            workflow_id: specId,
            new_name: args.values.get("--new-name"),
            ambient_agent_id: args.values.get("--ambient-agent-id"),
            dry_run: !args.flags.has("--yes"),
            confirm: args.flags.has("--yes"),
        }, global));
    }
    if (resource === "skill") {
        return await withMcp(async (mcp) => await invoke(mcp, "yaaif_skill_copy", {
            source_profile_id: source,
            destination_profile_id: destination,
            skill_id: specId,
            new_skill_id: args.values.get("--new-id"),
            dry_run: !args.flags.has("--yes"),
            confirm: args.flags.has("--yes"),
        }, global));
    }
    if (resource !== "scenario")
        throw new Error("usage: yaaif copy scenario|skill ID --from PROFILE --to PROFILE [--dry-run | --yes]");
    return await withMcp(async (mcp) => await invoke(mcp, "yaaif_scenario_copy", {
        source_profile_id: source,
        destination_profile_id: destination,
        spec_id: specId,
        revision,
        new_slug: args.values.get("--new-slug"),
        dry_run: !args.flags.has("--yes"),
        confirm: args.flags.has("--yes"),
    }, global));
}
async function runPlugins(argv, global) {
    const action = argv[0];
    if (action === "list") {
        printData(await pluginCatalog(), global.json);
        return 0;
    }
    if (action === "check") {
        const args = parseArgs(argv.slice(1), { strings: ["--client", "--plugin-src"], booleans: ["--online"] });
        const client = required(args.values.get("--client"), "--client is required");
        if (!PLUGIN_CLIENTS.includes(client))
            throw new Error(`unsupported client: ${client}`);
        const result = await checkPlugin({ client, pluginSrc: args.values.get("--plugin-src"), online: args.flags.has("--online") });
        printData(result, global.json);
        return result.ok ? 0 : 1;
    }
    if (action === "install" || action === "update") {
        const client = required(argv[1], `usage: yaaif plugins ${action} CLIENT [options]`);
        if (!PLUGIN_CLIENTS.includes(client))
            throw new Error(`unsupported client: ${client}`);
        return await installOrUpdatePlugin(action, client, argv.slice(2));
    }
    throw new Error("usage: yaaif plugins list|check|install|update");
}
export async function runYaaifCli(rawArgv) {
    const global = { json: rawArgv.includes("--json"), table: rawArgv.includes("--table") };
    if (global.json && global.table)
        throw new Error("use only one of --json and --table");
    const argv = rawArgv.filter((arg) => arg !== "--json" && arg !== "--table");
    if (argv.includes("--version") || argv.includes("-v")) {
        process.stdout.write(`${PACKAGE_VERSION}\n`);
        return 0;
    }
    if (!argv.length || argv.includes("--help") || argv.includes("-h")) {
        process.stdout.write(HELP);
        return 0;
    }
    const [command, ...rest] = argv;
    if (command === "completion") {
        const shell = required(rest[0], "usage: yaaif completion bash|zsh|fish");
        if (!["bash", "zsh", "fish"].includes(shell))
            throw new Error(`unsupported shell: ${shell}`);
        process.stdout.write(completionScript(shell));
        return 0;
    }
    if (["setup", "auth", "whoami", "profile", "tenant", "doctor", "features"].includes(command))
        return await runSession(command, rest, global);
    if (["catalog", "agents", "skills", "mcp", "ambient", "specs", "approvals"].includes(command))
        return await runCatalog(command, rest, global);
    if (["wiki", "updates"].includes(command))
        return await runKnowledge(command, rest, global);
    if (command === "copy")
        return await runCopy(rest, global);
    if (command === "tools")
        return await runTools(rest, global);
    if (command === "plugins")
        return await runPlugins(rest, global);
    throw new Error(`unknown command: ${command}; run yaaif --help`);
}
runYaaifCli(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
}).catch((error) => {
    process.stderr.write(`yaaif: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
});
