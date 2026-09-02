import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { checkInstallerUpdate, compareDottedVersion } from "./installerUpdate.js";

describe("compareDottedVersion", () => {
  it("orders 1.1.0 below 1.2.0", () => {
    assert.equal(compareDottedVersion("1.1.0", "1.2.0"), -1);
    assert.equal(compareDottedVersion("1.2.0", "1.1.0"), 1);
    assert.equal(compareDottedVersion("1.1.0", "1.1.0"), 0);
  });
});

describe("checkInstallerUpdate", () => {
  it("skips when no manifest", async () => {
    const dir = await mkdtemp(join(tmpdir(), "yaaif-ins-"));
    const r = await checkInstallerUpdate(dir, async () => {
      throw new Error("should not fetch");
    });
    assert.equal(r.ok, true);
    assert.equal(r.detail.skipped, "no_local_installer_manifest");
  });

  it("flags an older installed version", async () => {
    const dir = await mkdtemp(join(tmpdir(), "yaaif-ins-"));
    await writeFile(join(dir, "install-manifest.json"), JSON.stringify({ plugin_version: "1.1.0" }));
    const r = await checkInstallerUpdate(dir, async () =>
      new Response(JSON.stringify({ tag_name: "v1.2.0", html_url: "https://example.com" }), { status: 200 }),
    );
    assert.equal(r.ok, false);
    assert.equal(r.detail.latest, "1.2.0");
  });

  it("stays green when current", async () => {
    const dir = await mkdtemp(join(tmpdir(), "yaaif-ins-"));
    await writeFile(join(dir, "install-manifest.json"), JSON.stringify({ plugin_version: "1.2.0" }));
    const r = await checkInstallerUpdate(dir, async () =>
      new Response(JSON.stringify({ tag_name: "v1.2.0" }), { status: 200 }),
    );
    assert.equal(r.ok, true);
    assert.equal(r.detail.current, true);
  });
});
