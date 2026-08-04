import { readFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import tls from "node:tls";
import type { Config } from "../config.js";

export type TlsMaterial = {
  ca?: string | string[];
  cert?: string;
  key?: string;
};

let material: TlsMaterial = {};

function readOptional(path: string | undefined): string | undefined {
  const p = (path || "").trim();
  if (!p) return undefined;
  return readFileSync(p, "utf8");
}

/** Load CA / client cert material for subsequent yaaifFetch calls. */
export function installTlsDispatcher(cfg: Config): TlsMaterial | null {
  const caFile = cfg.extraCaFile || process.env.YAAIF_EXTRA_CA_FILE || process.env.NODE_EXTRA_CA_CERTS;
  const certFile = cfg.clientCertFile || process.env.YAAIF_CLIENT_CERT_FILE;
  const keyFile = cfg.clientKeyFile || process.env.YAAIF_CLIENT_KEY_FILE;
  const caPem = readOptional(caFile);
  const certPem = readOptional(certFile);
  const keyPem = readOptional(keyFile);
  if (!caPem && !certPem) {
    material = {};
    return null;
  }
  material = {
    ca: caPem ? [...tls.rootCertificates, caPem] : undefined,
    cert: certPem && keyPem ? certPem : undefined,
    key: certPem && keyPem ? keyPem : undefined,
  };
  return material;
}

export function getTlsMaterial(): TlsMaterial {
  return material;
}

/** fetch()-compatible helper that applies optional extra CA / client mTLS. */
export async function yaaifFetch(input: string | URL, init: RequestInit = {}): Promise<Response> {
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

  const tlsOpts = getTlsMaterial();
  const agent = isHttps
    ? new https.Agent({
      ...(tlsOpts.ca ? { ca: tlsOpts.ca } : {}),
      ...(tlsOpts.cert && tlsOpts.key ? { cert: tlsOpts.cert, key: tlsOpts.key } : {}),
    })
    : new http.Agent();

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
    req.on("error", reject);
    if (body != null) req.write(body);
    req.end();
  });
}
