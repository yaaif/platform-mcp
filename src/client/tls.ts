import { existsSync, readFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import { homedir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import tls from "node:tls";
import type { Config } from "../config.js";

export type TlsMaterial = {
  ca?: string | string[];
  cert?: string;
  key?: string;
};

export type TlsResolveInfo = {
  /** Absolute path actually loaded into the HTTPS agent (if any). */
  ca_file: string | null;
  /** How the CA was chosen. */
  ca_source: "explicit" | "mkcert-auto" | "none";
  /** True when config URLs target *.yaaif.local (local Traefik / mkcert). */
  local_dev_hosts: boolean;
  /** Candidate mkcert paths that exist on disk (for doctor hints). */
  mkcert_candidates: string[];
};

let material: TlsMaterial = {};
let resolveInfo: TlsResolveInfo = {
  ca_file: null,
  ca_source: "none",
  local_dev_hosts: false,
  mkcert_candidates: [],
};

function readOptional(path: string | undefined): string | undefined {
  const p = (path || "").trim();
  if (!p) return undefined;
  return readFileSync(p, "utf8");
}

/** Ignore empty values and unexpanded plugin placeholders like `${YAAIF_EXTRA_CA_FILE}`. */
export function resolvedPath(raw: string | undefined | null): string {
  const v = (raw ?? "").trim();
  if (!v || /^\$\{[A-Z0-9_]+\}$/.test(v)) return "";
  return v;
}

function hostFromUrl(raw: string): string {
  try {
    return new URL(raw).hostname.toLowerCase();
  } catch {
    return "";
  }
}

/** Local Traefik / mkcert hosts used by builtin `local` and `local-hybrid` profiles. */
export function configUsesLocalDevHosts(cfg: Config): boolean {
  const hosts = [
    cfg.apiBaseUrl,
    cfg.agentBaseUrl,
    cfg.controlPlaneBaseUrl,
    cfg.approvalBaseUrl,
    cfg.oidcAuthority,
  ].map(hostFromUrl);
  return hosts.some((h) => h === "yaaif.local" || h.endsWith(".yaaif.local"));
}

function mkcertCarootFromCli(): string | undefined {
  try {
    const out = execFileSync("mkcert", ["-CAROOT"], {
      encoding: "utf8",
      timeout: 1500,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return out || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Discover mkcert root CA paths (macOS / Linux / CAROOT / `mkcert -CAROOT`).
 * Node does not trust the system keychain by default, so local Traefik mkcert
 * certs need this PEM even after `mkcert -install`.
 */
export function discoverMkcertCaCandidates(env: NodeJS.ProcessEnv = process.env): string[] {
  const out: string[] = [];
  const push = (p: string | undefined) => {
    const path = (p || "").trim();
    if (!path || out.includes(path)) return;
    out.push(path);
  };

  const caroot = (env.CAROOT || "").trim();
  if (caroot) push(join(caroot, "rootCA.pem"));

  const home = homedir();
  push(join(home, "Library", "Application Support", "mkcert", "rootCA.pem"));
  push(join(home, ".local", "share", "mkcert", "rootCA.pem"));

  const cliRoot = mkcertCarootFromCli();
  if (cliRoot) push(join(cliRoot, "rootCA.pem"));

  return out.filter((p) => existsSync(p));
}

export function resolveCaFile(cfg: Config, env: NodeJS.ProcessEnv = process.env): TlsResolveInfo {
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
      ca_file: candidates[0]!,
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
export function installTlsDispatcher(cfg: Config): TlsMaterial | null {
  const resolved = resolveCaFile(cfg);
  resolveInfo = resolved;

  const certFile = resolvedPath(cfg.clientCertFile) || resolvedPath(process.env.YAAIF_CLIENT_CERT_FILE);
  const keyFile = resolvedPath(cfg.clientKeyFile) || resolvedPath(process.env.YAAIF_CLIENT_KEY_FILE);
  const caPems: string[] = [];
  const loadedFiles: string[] = [];
  const pushFile = (path: string | undefined, required: boolean) => {
    const p = resolvedPath(path);
    if (!p || loadedFiles.includes(p)) return;
    try {
      const pem = readOptional(p);
      if (!pem?.trim()) return;
      if (!caPems.includes(pem)) caPems.push(pem);
      loadedFiles.push(p);
    } catch (err) {
      if (required) throw err;
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
        ca_file: loadedFiles[0]!,
        ca_source: resolveInfo.ca_source === "explicit" ? "explicit" : "mkcert-auto",
        mkcert_candidates: mkcertPaths,
      };
    } else if (resolved.mkcert_candidates.length === 0 && mkcertPaths.length > 0) {
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

export function getTlsMaterial(): TlsMaterial {
  return material;
}

export function getTlsResolveInfo(): TlsResolveInfo {
  return resolveInfo;
}

export type YaaifFetchInit = Omit<RequestInit, "body"> & {
  timeoutMs?: number;
  body?: RequestInit["body"] | Buffer;
  /** Extra attempts after a transient failure. Defaults to 2 for GET/HEAD and 0 otherwise. */
  retries?: number;
};

// One keep-alive agent per TLS material. A new agent per request repeats the
// TCP and mTLS handshake, and rebuilds the CA context, on every tool call.
let agentMaterial: TlsMaterial | null = null;
let sharedHttpsAgent: https.Agent | null = null;
let sharedHttpAgent: http.Agent | null = null;

function sharedAgent(isHttps: boolean): https.Agent | http.Agent {
  const tlsOpts = getTlsMaterial();
  if (agentMaterial !== tlsOpts) {
    sharedHttpsAgent?.destroy();
    sharedHttpAgent?.destroy();
    sharedHttpsAgent = null;
    sharedHttpAgent = null;
    agentMaterial = tlsOpts;
  }
  if (isHttps) {
    sharedHttpsAgent ??= new https.Agent({
      keepAlive: true,
      maxSockets: 16,
      ...(tlsOpts.ca ? { ca: tlsOpts.ca } : {}),
      ...(tlsOpts.cert && tlsOpts.key ? { cert: tlsOpts.cert, key: tlsOpts.key } : {}),
    });
    return sharedHttpsAgent;
  }
  sharedHttpAgent ??= new http.Agent({ keepAlive: true, maxSockets: 16 });
  return sharedHttpAgent;
}

const TRANSIENT_STATUS = new Set([502, 503, 504]);
const TRANSIENT_CODES = new Set(["ECONNRESET", "ECONNREFUSED", "EAI_AGAIN", "EPIPE"]);
const RETRY_DELAYS_MS = [250, 750];

type StaleSocketError = Error & { code?: string; staleSocket?: boolean };

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * fetch()-compatible helper that applies optional extra CA / client mTLS.
 * GET and HEAD retry briefly on gateway errors and connection resets, which is
 * what a service restart looks like. A reused keep-alive socket that the server
 * already closed is retried once for any method, because that request never ran.
 */
export async function yaaifFetch(input: string | URL, init: YaaifFetchInit = {}): Promise<Response> {
  const method = (init.method || "GET").toUpperCase();
  const idempotent = method === "GET" || method === "HEAD";
  const retries = Math.min(init.retries ?? (idempotent ? RETRY_DELAYS_MS.length : 0), RETRY_DELAYS_MS.length);
  let staleRetried = false;
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await yaaifFetchOnce(input, init);
      if (idempotent && attempt < retries && TRANSIENT_STATUS.has(res.status)) {
        await sleep(RETRY_DELAYS_MS[attempt]!);
        continue;
      }
      return res;
    } catch (err) {
      const e = err as StaleSocketError;
      if (e.name === "AbortError" || init.signal?.aborted) throw err;
      if (e.staleSocket && !staleRetried) {
        staleRetried = true;
        attempt--;
        continue;
      }
      if (idempotent && attempt < retries && e.code && TRANSIENT_CODES.has(e.code)) {
        await sleep(RETRY_DELAYS_MS[attempt]!);
        continue;
      }
      throw err;
    }
  }
}

async function yaaifFetchOnce(input: string | URL, init: YaaifFetchInit): Promise<Response> {
  const url = typeof input === "string" ? new URL(input) : input;
  const isHttps = url.protocol === "https:";
  const headers = new Headers(init.headers);
  const method = (init.method || "GET").toUpperCase();
  let body: string | Buffer | undefined;
  if (init.body != null) {
    body = typeof init.body === "string" || Buffer.isBuffer(init.body)
      ? init.body as string | Buffer
      : String(init.body);
  }
  if (Buffer.isBuffer(body) && !headers.has("Content-Length")) {
    headers.set("Content-Length", String(body.length));
  }

  const agent = sharedAgent(isHttps);

  return new Promise((resolve, reject) => {
    const reqFn = isHttps ? https.request : http.request;
    const req = reqFn(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: `${url.pathname}${url.search}`,
        method,
        headers: Object.fromEntries(headers.entries()),
        agent,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
        res.on("end", () => {
          const buf = Buffer.concat(chunks);
          const rh = new Headers();
          for (const [k, v] of Object.entries(res.headers)) {
            if (v == null) continue;
            rh.set(k, Array.isArray(v) ? v.join(", ") : String(v));
          }
          resolve(new Response(buf, { status: res.statusCode ?? 0, headers: rh }));
        });
      },
    );
    req.on("error", (err: StaleSocketError) => {
      if (req.reusedSocket && err.code === "ECONNRESET") err.staleSocket = true;
      reject(err);
    });
    req.setTimeout(init.timeoutMs ?? 30_000, () => {
      req.destroy(new Error(`request timed out: ${url.toString()}`));
    });
    if (init.signal) {
      if (init.signal.aborted) {
        req.destroy();
        reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
        return;
      }
      const onAbort = () => {
        req.destroy();
        reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
      };
      init.signal.addEventListener("abort", onAbort, { once: true });
      req.on("close", () => init.signal?.removeEventListener("abort", onAbort));
    }
    if (body != null) req.write(body);
    req.end();
  });
}
