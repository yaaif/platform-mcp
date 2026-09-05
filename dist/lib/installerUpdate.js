import { readFile } from "node:fs/promises";
import { join } from "node:path";
function parseDots(v) {
    return v.split(/[.-]/).filter((p) => /^\d+$/.test(p)).map((p) => Number(p));
}
export function compareDottedVersion(a, b) {
    const pa = parseDots(a);
    const pb = parseDots(b);
    const n = Math.max(pa.length, pb.length);
    for (let i = 0; i < n; i += 1) {
        const da = pa[i] ?? 0;
        const db = pb[i] ?? 0;
        if (da < db)
            return -1;
        if (da > db)
            return 1;
    }
    return 0;
}
export async function checkInstallerUpdate(stateHome, fetchFn = fetch) {
    const manifestPath = join(stateHome, "install-manifest.json");
    let installed = "";
    try {
        const raw = JSON.parse(await readFile(manifestPath, "utf8"));
        installed = String(raw.plugin_version || "");
    }
    catch {
        return {
            ok: true,
            detail: { skipped: "no_local_installer_manifest", hint: "Marketplace or manual copy (no installer manifest)." },
        };
    }
    if (!installed) {
        return { ok: true, detail: { skipped: "empty_plugin_version", path: manifestPath } };
    }
    try {
        const ac = new AbortController();
        const t = setTimeout(() => ac.abort(), 4000);
        const res = await fetchFn("https://api.github.com/repos/yaaif/cursor-plugin/releases/latest", {
            headers: { Accept: "application/vnd.github+json", "User-Agent": "yaaif-cursor-plugin-doctor" },
            signal: ac.signal,
        });
        clearTimeout(t);
        if (!res.ok) {
            return { ok: true, detail: { skipped: "github_http", status: res.status, installed } };
        }
        const body = await res.json();
        const latest = String(body.tag_name || "").replace(/^v/i, "");
        if (!latest) {
            return { ok: true, detail: { skipped: "no_tag", installed } };
        }
        const cmp = compareDottedVersion(installed, latest);
        if (cmp < 0) {
            return {
                ok: false,
                detail: {
                    installed,
                    latest,
                    hint: `A newer installer is on GitHub (${latest}). Download from https://github.com/yaaif/cursor-plugin/releases then reload Cursor.`,
                    url: body.html_url || "https://github.com/yaaif/cursor-plugin/releases",
                },
            };
        }
        return { ok: true, detail: { installed, latest, current: true } };
    }
    catch (e) {
        return { ok: true, detail: { skipped: "github_unreachable", installed, error: String(e).slice(0, 180) } };
    }
}
