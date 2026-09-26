export const TOOL_INSTALL_SKILL_ID = "__tool_install";
export const TOOL_REMOVE_SKILL_ID = "__tool_remove";
export const TOOL_INSTALL_DISPATCH_TYPE = "tool_install";
export const TOOL_REMOVE_DISPATCH_TYPE = "tool_remove";
export function collectWorkerIds(workerId, workerIds) {
    const out = [];
    const seen = new Set();
    for (const raw of [workerId, ...(workerIds ?? [])]) {
        const id = String(raw ?? "").trim();
        if (!id || seen.has(id))
            continue;
        seen.add(id);
        out.push(id);
    }
    return out;
}
function payloadString(payload, key) {
    const value = payload?.[key];
    return typeof value === "string" ? value.trim() : "";
}
export function runDispatchType(run) {
    return payloadString(run.payload, "dispatch_type").toLowerCase();
}
export function isLifecycleRunForPackage(run, packageId, toolKey) {
    const pkg = payloadString(run.payload, "package_id");
    const key = payloadString(run.payload, "tool_key");
    if (packageId && pkg === packageId)
        return true;
    return Boolean(toolKey) && key.toLowerCase() === toolKey.toLowerCase();
}
export function latestLifecycleRun(runs, workerId, packageId, toolKey) {
    let latest = null;
    let latestMs = Number.NEGATIVE_INFINITY;
    for (const run of runs) {
        if (String(run.worker_id ?? "").trim() !== workerId)
            continue;
        if (!isLifecycleRunForPackage(run, packageId, toolKey))
            continue;
        const createdMs = Date.parse(String(run.created_at ?? ""));
        if (!Number.isFinite(createdMs) || createdMs < latestMs)
            continue;
        latest = run;
        latestMs = createdMs;
    }
    return latest;
}
export function latestInstalledVersion(runs, workerId, packageId, toolKey) {
    let version = "";
    let latestMs = Number.NEGATIVE_INFINITY;
    for (const run of runs) {
        if (String(run.worker_id ?? "").trim() !== workerId)
            continue;
        if (!isLifecycleRunForPackage(run, packageId, toolKey))
            continue;
        if (runDispatchType(run) === TOOL_REMOVE_DISPATCH_TYPE)
            continue;
        if (String(run.status ?? "").trim().toLowerCase() !== "completed")
            continue;
        const createdMs = Date.parse(String(run.created_at ?? ""));
        if (!Number.isFinite(createdMs) || createdMs < latestMs)
            continue;
        latestMs = createdMs;
        version = payloadString(run.payload, "version");
    }
    return version;
}
export function summarizeWorkerPackage(workerId, runs, packageId, toolKey, packageVersion) {
    const latest = latestLifecycleRun(runs, workerId, packageId, toolKey);
    const dispatch = latest ? runDispatchType(latest) : "";
    const status = String(latest?.status ?? "").trim().toLowerCase();
    const installedVersion = latestInstalledVersion(runs, workerId, packageId, toolKey);
    const removeInFlight = dispatch === TOOL_REMOVE_DISPATCH_TYPE &&
        (status === "queued" || status === "running" || status === "leased");
    const installInFlight = dispatch === TOOL_INSTALL_DISPATCH_TYPE &&
        (status === "queued" || status === "running" || status === "leased");
    const installed = dispatch === TOOL_INSTALL_DISPATCH_TYPE && status === "completed";
    const failed = status === "failed" || status === "canceled";
    const updateAvailable = Boolean(installed && installedVersion && packageVersion && installedVersion !== packageVersion);
    let recommended = "install";
    if (removeInFlight || installInFlight)
        recommended = "wait";
    else if (installed && updateAvailable)
        recommended = "upgrade";
    else if (installed)
        recommended = "none";
    else if (failed)
        recommended = "retry";
    return {
        worker_id: workerId,
        latest_run_id: latest?.id ? String(latest.id) : null,
        latest_status: status || "none",
        dispatch_type: dispatch,
        installed,
        installed_version: installed ? installedVersion : "",
        package_version: packageVersion,
        update_available: updateAvailable,
        recommended_action: recommended,
    };
}
