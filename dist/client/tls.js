import { existsSync, readFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import { homedir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import tls from "node:tls";
let material = {};
let resolveInfo = {
    ca_file: null,
    ca_source: "none",
    local_dev_hosts: false,
    mkcert_candidates: [],
};
function readOptional(path) {
    const p = (path || "").trim();
    if (!p)
        return undefined;
    return readFileSync(p, "utf8");
}
/** Ignore empty values and unexpanded plugin placeholders like `${YAAIF_EXTRA_CA_FILE}`. */
export function resolvedPath(raw) {
    const v = (raw ?? "").trim();
    if (!v || /^\$\{[A-Z0-9_]+\}$/.test(v))
        return "";
    return v;
}
function hostFromUrl(raw) {
    try {
        return new URL(raw).hostname.toLowerCase();
    }
    catch {
        return "";
    }
}
/** Local Traefik / mkcert hosts used by builtin `local` and `local-hybrid` profiles. */
export function configUsesLocalDevHosts(cfg) {
    const hosts = [
        cfg.apiBaseUrl,
        cfg.agentBaseUrl,
        cfg.controlPlaneBaseUrl,
        cfg.approvalBaseUrl,
        cfg.oidcAuthority,
    ].map(hostFromUrl);
    return hosts.some((h) => h === "yaaif.local" || h.endsWith(".yaaif.local"));
}
function mkcertCarootFromCli() {
    try {
        const out = execFileSync("mkcert", ["-CAROOT"], {
            encoding: "utf8",
            timeout: 1500,
            stdio: ["ignore", "pipe", "ignore"],
        }).trim();
        return out || undefined;
    }
    catch {
        return undefined;
    }
}
/**
 * Discover mkcert root CA paths (macOS / Linux / CAROOT / `mkcert -CAROOT`).
 * Node does not trust the system keychain by default, so local Traefik mkcert
 * certs need this PEM even after `mkcert -install`.
 */
export function discoverMkcertCaCandidates(env = process.env) {
    const out = [];
    const push = (p) => {
        const path = (p || "").trim();
        if (!path || out.includes(path))
            return;
        out.push(path);
    };
    const caroot = (env.CAROOT || "").trim();
    if (caroot)
        push(join(caroot, "rootCA.pem"));
    const home = homedir();
    push(join(home, "Library", "Application Support", "mkcert", "rootCA.pem"));
    push(join(home, ".local", "share", "mkcert", "rootCA.pem"));
    const cliRoot = mkcertCarootFromCli();
    if (cliRoot)
        push(join(cliRoot, "rootCA.pem"));
    return out.filter((p) => existsSync(p));
}
export function resolveCaFile(cfg, env = process.env) {
    const localDev = configUsesLocalDevHosts(cfg);
    const candidates = localDev ? discoverMkcertCaCandidates(env) : [];
    const explicit = resolvedPath(cfg.extraCaFile)
        || resolvedPath(env.YAAIF_EXTRA_CA_FILE)
        || resolvedPath(env.NODE_EXTRA_CA_CERTS);
    if (explicit) {
        return {
            ca_file: explicit,
            ca_source: "explicit",
            local_dev_hosts: localDev,
            mkcert_candidates: candidates,
        };
    }
    if (localDev && candidates.length > 0) {
        return {
            ca_file: candidates[0],
            ca_source: "mkcert-auto",
            local_dev_hosts: localDev,
            mkcert_candidates: candidates,
        };
    }
    return {
        ca_file: null,
        ca_source: "none",
        local_dev_hosts: localDev,
        mkcert_candidates: candidates,
    };
}
/**
 * Load CA / client cert material for subsequent yaaifFetch calls.
 *
 * For `*.yaaif.local`, always merge the mkcert root CA when present — even if
 * `YAAIF_EXTRA_CA_FILE` / `NODE_EXTRA_CA_CERTS` already set an explicit CA —
 * so plugin variables or a corporate bundle cannot shadow Traefik trust.
 */
export function installTlsDispatcher(cfg) {
    const resolved = resolveCaFile(cfg);
    resolveInfo = resolved;
    const certFile = resolvedPath(cfg.clientCertFile) || resolvedPath(process.env.YAAIF_CLIENT_CERT_FILE);
    const keyFile = resolvedPath(cfg.clientKeyFile) || resolvedPath(process.env.YAAIF_CLIENT_KEY_FILE);
    const caPems = [];
    const loadedFiles = [];
    const pushFile = (path, required) => {
        const p = resolvedPath(path);
        if (!p || loadedFiles.includes(p))
            return;
        try {
            const pem = readOptional(p);
            if (!pem?.trim())
                return;
            if (!caPems.includes(pem))
                caPems.push(pem);
            loadedFiles.push(p);
        }
        catch (err) {
            if (required)
                throw err;
        }
    };
    pushFile(resolved.ca_file || undefined, resolved.ca_source === "explicit");
    if (resolved.local_dev_hosts) {
        const mkcertPaths = resolved.mkcert_candidates.length
            ? resolved.mkcert_candidates
            : discoverMkcertCaCandidates();
        for (const candidate of mkcertPaths) {
            pushFile(candidate, false);
        }
        if (!resolveInfo.ca_file && loadedFiles[0]) {
            resolveInfo = {
                ...resolveInfo,
                ca_file: loadedFiles[0],
                ca_source: resolveInfo.ca_source === "explicit" ? "explicit" : "mkcert-auto",
                mkcert_candidates: mkcertPaths,
            };
        }
        else if (resolved.mkcert_candidates.length === 0 && mkcertPaths.length > 0) {
            resolveInfo = { ...resolveInfo, mkcert_candidates: mkcertPaths };
        }
    }
    if (!caPems.length && resolved.ca_source === "mkcert-auto") {
        resolveInfo = { ...resolved, ca_file: null, ca_source: "none" };
    }
    const certPem = readOptional(certFile);
    const keyPem = readOptional(keyFile);
    if (!caPems.length && !certPem) {
        material = {};
        return null;
    }
    material = {
        ca: caPems.length ? [...tls.rootCertificates, ...caPems] : undefined,
        cert: certPem && keyPem ? certPem : undefined,
        key: certPem && keyPem ? keyPem : undefined,
    };
    return material;
}
export function getTlsMaterial() {
    return material;
}
export function getTlsResolveInfo() {
    return resolveInfo;
}
/** fetch()-compatible helper that applies optional extra CA / client mTLS. */
export async function yaaifFetch(input, init = {}) {
    const url = typeof input === "string" ? new URL(input) : input;
    const isHttps = url.protocol === "https:";
    const headers = new Headers(init.headers);
    const method = (init.method || "GET").toUpperCase();
    let body;
    if (init.body != null) {
        body = typeof init.body === "string" || Buffer.isBuffer(init.body)
            ? init.body
            : String(init.body);
    }
    const tlsOpts = getTlsMaterial();
    const agent = isHttps
        ? new https.Agent({
            ...(tlsOpts.ca ? { ca: tlsOpts.ca } : {}),
            ...(tlsOpts.cert && tlsOpts.key ? { cert: tlsOpts.cert, key: tlsOpts.key } : {}),
        })
        : new http.Agent();
    return new Promise((resolve, reject) => {
        const reqFn = isHttps ? https.request : http.request;
        const req = reqFn({
            protocol: url.protocol,
            hostname: url.hostname,
            port: url.port || (isHttps ? 443 : 80),
            path: `${url.pathname}${url.search}`,
            method,
            headers: Object.fromEntries(headers.entries()),
            agent,
        }, (res) => {
            const chunks = [];
            res.on("data", (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
            res.on("end", () => {
                const buf = Buffer.concat(chunks);
                const rh = new Headers();
                for (const [k, v] of Object.entries(res.headers)) {
                    if (v == null)
                        continue;
                    rh.set(k, Array.isArray(v) ? v.join(", ") : String(v));
                }
                resolve(new Response(buf, { status: res.statusCode ?? 0, headers: rh }));
            });
        });
        req.on("error", reject);
        if (body != null)
            req.write(body);
        req.end();
    });
}
