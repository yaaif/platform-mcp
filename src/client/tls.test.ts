import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { clientDescriptor, type Config } from "../config.js";
import {
  configUsesLocalDevHosts,
  discoverMkcertCaCandidates,
  installTlsDispatcher,
  resolveCaFile,
} from "./tls.js";

function baseCfg(over: Partial<Config> = {}): Config {
  return {
    client: clientDescriptor("cursor"),
    oidcAuthority: "https://platform.yaaif.com/auth/realms/yaaif",
    oidcClientId: "yaaif-cursor",
    oidcScopes: ["openid"],
    apiBaseUrl: "https://platform.yaaif.local",
    agentBaseUrl: "https://platform.yaaif.local/agent-service",
    controlPlaneBaseUrl: "https://platform.yaaif.local/control-plane-service",
    approvalBaseUrl: "https://platform.yaaif.local/approval-service",
    defaultTenantId: "",
    stateHome: "/tmp/yaaif-cursor-test",
    activeProfileId: "local-hybrid",
    extraCaFile: "",
    clientCertFile: "",
    clientKeyFile: "",
    ...over,
  };
}

test("configUsesLocalDevHosts detects .yaaif.local API hosts", () => {
  assert.equal(configUsesLocalDevHosts(baseCfg()), true);
  assert.equal(
    configUsesLocalDevHosts(
      baseCfg({
        apiBaseUrl: "https://platform.yaaif.ai",
        agentBaseUrl: "https://platform.yaaif.ai/agent-service",
        controlPlaneBaseUrl: "https://platform.yaaif.ai/control-plane-service",
        approvalBaseUrl: "https://platform.yaaif.ai/approval-service",
        oidcAuthority: "https://platform.yaaif.ai/auth/realms/yaaif",
        activeProfileId: "hosted",
      }),
    ),
    false,
  );
});

test("resolveCaFile prefers explicit CA over mkcert auto", () => {
  const dir = mkdtempSync(join(tmpdir(), "yaaif-tls-"));
  const explicit = join(dir, "corp.pem");
  const mk = join(dir, "rootCA.pem");
  writeFileSync(explicit, "-----BEGIN CERTIFICATE-----\nEXPLICIT\n-----END CERTIFICATE-----\n");
  writeFileSync(mk, "-----BEGIN CERTIFICATE-----\nMKCERT\n-----END CERTIFICATE-----\n");
  const info = resolveCaFile(baseCfg({ extraCaFile: explicit }), { CAROOT: dir } as NodeJS.ProcessEnv);
  assert.equal(info.ca_source, "explicit");
  assert.equal(info.ca_file, explicit);
  assert.equal(info.local_dev_hosts, true);
});

test("resolveCaFile auto-picks mkcert CA for local-hybrid", () => {
  const dir = mkdtempSync(join(tmpdir(), "yaaif-tls-"));
  const mk = join(dir, "rootCA.pem");
  writeFileSync(mk, "-----BEGIN CERTIFICATE-----\nMKCERT\n-----END CERTIFICATE-----\n");
  const info = resolveCaFile(baseCfg({ extraCaFile: "" }), {
    CAROOT: dir,
    YAAIF_EXTRA_CA_FILE: "",
    NODE_EXTRA_CA_CERTS: "",
  } as NodeJS.ProcessEnv);
  assert.equal(info.ca_source, "mkcert-auto");
  assert.equal(info.ca_file, mk);
  assert.ok(info.mkcert_candidates.includes(mk));
});

test("resolveCaFile does not auto-pick mkcert for hosted", () => {
  const dir = mkdtempSync(join(tmpdir(), "yaaif-tls-"));
  writeFileSync(join(dir, "rootCA.pem"), "-----BEGIN CERTIFICATE-----\nMKCERT\n-----END CERTIFICATE-----\n");
  const info = resolveCaFile(
    baseCfg({
      apiBaseUrl: "https://platform.yaaif.ai",
      agentBaseUrl: "https://platform.yaaif.ai/agent-service",
      controlPlaneBaseUrl: "https://platform.yaaif.ai/control-plane-service",
      approvalBaseUrl: "https://platform.yaaif.ai/approval-service",
      oidcAuthority: "https://platform.yaaif.ai/auth/realms/yaaif",
      activeProfileId: "hosted",
      extraCaFile: "",
    }),
    { CAROOT: dir } as NodeJS.ProcessEnv,
  );
  assert.equal(info.ca_source, "none");
  assert.equal(info.ca_file, null);
});

test("discoverMkcertCaCandidates reads CAROOT", () => {
  const dir = mkdtempSync(join(tmpdir(), "yaaif-tls-"));
  mkdirSync(dir, { recursive: true });
  const mk = join(dir, "rootCA.pem");
  writeFileSync(mk, "x");
  assert.deepEqual(discoverMkcertCaCandidates({ CAROOT: dir } as NodeJS.ProcessEnv).filter((p) => p === mk), [mk]);
});

test("installTlsDispatcher loads auto mkcert CA into agent material", () => {
  const dir = mkdtempSync(join(tmpdir(), "yaaif-tls-"));
  const mk = join(dir, "rootCA.pem");
  writeFileSync(mk, "-----BEGIN CERTIFICATE-----\nMKCERT\n-----END CERTIFICATE-----\n");
  const prev = process.env.CAROOT;
  const prevExtra = process.env.YAAIF_EXTRA_CA_FILE;
  const prevNode = process.env.NODE_EXTRA_CA_CERTS;
  process.env.CAROOT = dir;
  delete process.env.YAAIF_EXTRA_CA_FILE;
  delete process.env.NODE_EXTRA_CA_CERTS;
  try {
    const mat = installTlsDispatcher(baseCfg({ extraCaFile: "" }));
    assert.ok(mat?.ca);
    assert.ok(Array.isArray(mat!.ca));
    assert.ok((mat!.ca as string[]).some((pem) => pem.includes("MKCERT")));
  } finally {
    if (prev === undefined) delete process.env.CAROOT;
    else process.env.CAROOT = prev;
    if (prevExtra === undefined) delete process.env.YAAIF_EXTRA_CA_FILE;
    else process.env.YAAIF_EXTRA_CA_FILE = prevExtra;
    if (prevNode === undefined) delete process.env.NODE_EXTRA_CA_CERTS;
    else process.env.NODE_EXTRA_CA_CERTS = prevNode;
  }
});

test("resolveCaFile ignores unexpanded plugin placeholders", () => {
  const info = resolveCaFile(baseCfg({ extraCaFile: "${YAAIF_EXTRA_CA_FILE}" }), {
    YAAIF_EXTRA_CA_FILE: "${YAAIF_EXTRA_CA_FILE}",
    NODE_EXTRA_CA_CERTS: "${NODE_EXTRA_CA_CERTS}",
    CAROOT: "",
  } as NodeJS.ProcessEnv);
  assert.notEqual(info.ca_source, "explicit");
});

test("installTlsDispatcher ignores placeholder client cert paths", () => {
  const dir = mkdtempSync(join(tmpdir(), "yaaif-tls-"));
  const mk = join(dir, "rootCA.pem");
  writeFileSync(mk, "-----BEGIN CERTIFICATE-----\nMKCERT\n-----END CERTIFICATE-----\n");
  const prev = process.env.CAROOT;
  process.env.CAROOT = dir;
  process.env.YAAIF_CLIENT_CERT_FILE = "${YAAIF_CLIENT_CERT_FILE}";
  process.env.YAAIF_CLIENT_KEY_FILE = "${YAAIF_CLIENT_KEY_FILE}";
  try {
    const mat = installTlsDispatcher(baseCfg({
      extraCaFile: "",
      clientCertFile: "${YAAIF_CLIENT_CERT_FILE}",
      clientKeyFile: "${YAAIF_CLIENT_KEY_FILE}",
    }));
    assert.ok(mat?.ca);
    assert.equal(mat?.cert, undefined);
  } finally {
    if (prev === undefined) delete process.env.CAROOT;
    else process.env.CAROOT = prev;
    delete process.env.YAAIF_CLIENT_CERT_FILE;
    delete process.env.YAAIF_CLIENT_KEY_FILE;
  }
});

test("installTlsDispatcher merges mkcert CA alongside explicit CA for local hosts", () => {
  const dir = mkdtempSync(join(tmpdir(), "yaaif-tls-"));
  const explicit = join(dir, "corp.pem");
  const mk = join(dir, "rootCA.pem");
  writeFileSync(explicit, "-----BEGIN CERTIFICATE-----\nEXPLICIT\n-----END CERTIFICATE-----\n");
  writeFileSync(mk, "-----BEGIN CERTIFICATE-----\nMKCERT\n-----END CERTIFICATE-----\n");
  const prev = process.env.CAROOT;
  const prevExtra = process.env.YAAIF_EXTRA_CA_FILE;
  const prevNode = process.env.NODE_EXTRA_CA_CERTS;
  process.env.CAROOT = dir;
  delete process.env.YAAIF_EXTRA_CA_FILE;
  delete process.env.NODE_EXTRA_CA_CERTS;
  try {
    const mat = installTlsDispatcher(baseCfg({ extraCaFile: explicit }));
    assert.ok(mat?.ca);
    const joined = (mat!.ca as string[]).join("\n");
    assert.ok(joined.includes("EXPLICIT"));
    assert.ok(joined.includes("MKCERT"));
  } finally {
    if (prev === undefined) delete process.env.CAROOT;
    else process.env.CAROOT = prev;
    if (prevExtra === undefined) delete process.env.YAAIF_EXTRA_CA_FILE;
    else process.env.YAAIF_EXTRA_CA_FILE = prevExtra;
    if (prevNode === undefined) delete process.env.NODE_EXTRA_CA_CERTS;
    else process.env.NODE_EXTRA_CA_CERTS = prevNode;
  }
});
