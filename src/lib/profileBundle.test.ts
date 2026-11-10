import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProfileBundle, importProfileBundle, readProfileBundle, validateProfileBundle, writeProfileBundle } from "./profileBundle.js";
import { ProfileStore } from "../platform/profiles.js";

function profile(id: string) {
  return {
    id,
    label: id,
    oidc_authority: `https://${id}.example/auth/realms/yaaif`,
    api_base_url: `https://${id}.example`,
    agent_base_url: `https://${id}.example/agent-service`,
    control_plane_base_url: `https://${id}.example/control-plane-service`,
    approval_base_url: `https://${id}.example/approval-service`,
  };
}

test("profile bundle round trip contains no sessions", async () => {
  const root = await mkdtemp(join(tmpdir(), "yaaif-profile-bundle-"));
  try {
    const path = join(root, "profiles.json");
    const bundle = createProfileBundle([profile("prod"), { ...profile("local-hybrid"), builtin: true }], "prod");
    await writeProfileBundle(path, bundle);
    const loaded = await readProfileBundle(path);
    assert.equal(loaded.format, "yaaif.platform-profiles/v1");
    assert.equal(loaded.profiles.length, 2);
    assert.doesNotMatch(await readFile(path, "utf8"), /access_token|refresh_token|session.json/);
    assert.throws(() => validateProfileBundle({ ...bundle, profiles: [{ ...profile("bad"), access_token: "secret" }] }), /forbidden field/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("profile bundle import previews and applies without overwriting", async () => {
  const root = await mkdtemp(join(tmpdir(), "yaaif-profile-import-"));
  try {
    const store = new ProfileStore(root);
    const bundle = createProfileBundle([profile("prod"), { ...profile("local-hybrid"), builtin: true }], "prod");
    const preview = await importProfileBundle(store, bundle, { dryRun: true, activate: "prod" });
    assert.equal(preview.import_count, 1);
    assert.equal(preview.skipped_builtin_count, 1);
    assert.equal(await store.get("prod"), null);
    const imported = await importProfileBundle(store, bundle, { dryRun: false, confirm: true, activate: "prod" });
    assert.equal(imported.imported, true);
    assert.equal((await store.get("prod"))?.api_base_url, "https://prod.example");
    assert.equal((await store.getActive())?.profile_id, "prod");
    await assert.rejects(() => importProfileBundle(store, bundle, { dryRun: false, confirm: true }), /already exist/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
