import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { ProfileStore } from "../platform/profiles.js";
import {
  chooseDetectedProfile,
  detectDefaultProfile,
  loginSkippedByEnv,
  parsePlatformPromptAnswer,
  parseProfileFlag,
  parseSetupAction,
  parseYaaifUrl,
  runInstallerSetup,
  shouldPromptPlatform,
  type ProbeMap,
} from "./installerSetup.js";

test("parseSetupAction reads --setup and --setup=", () => {
  assert.equal(parseSetupAction(["--client", "cursor", "--setup", "detect"]), "detect");
  assert.equal(parseSetupAction(["--setup=all", "--client", "cursor"]), "all");
  assert.equal(parseSetupAction(["--client", "cursor"]), null);
  assert.throws(() => parseSetupAction(["--setup"]), /detect\|profile/);
  assert.throws(() => parseSetupAction(["--setup", "nope"]), /detect\|profile/);
});

test("parseProfileFlag reads --profile / --profile-id", () => {
  assert.equal(parseProfileFlag(["--profile", "hosted"]), "hosted");
  assert.equal(parseProfileFlag(["--profile=local"]), "local");
  assert.equal(parseProfileFlag(["--profile-id", "local-hybrid"]), "local-hybrid");
  assert.equal(parseProfileFlag(["--client", "cursor"]), undefined);
});

test("parseYaaifUrl reads --yaaif-url / --platform-url", () => {
  assert.equal(parseYaaifUrl(["--yaaif-url", "https://acme.example"]), "https://acme.example");
  assert.equal(parseYaaifUrl(["--yaaif-url=https://acme.example"]), "https://acme.example");
  assert.equal(parseYaaifUrl(["--platform-url", "platform.yaaif.local"]), "platform.yaaif.local");
  assert.equal(parseYaaifUrl(["--client", "claude"]), undefined);
});

test("parsePlatformPromptAnswer does not treat empty as hosted", () => {
  assert.equal(parsePlatformPromptAnswer("", { hasExisting: false }).action, "invalid");
  assert.equal(parsePlatformPromptAnswer("1", { hasExisting: false }).action, "hosted");
  assert.equal(parsePlatformPromptAnswer("2", { hasExisting: false }).action, "other");
  assert.equal(parsePlatformPromptAnswer("https://acme.example", { hasExisting: false }).action, "url");
  assert.equal(parsePlatformPromptAnswer("1", { hasExisting: true }).action, "keep");
  assert.equal(parsePlatformPromptAnswer("2", { hasExisting: true }).action, "hosted");
  assert.equal(parsePlatformPromptAnswer("3", { hasExisting: true }).action, "other");
});

test("shouldPromptPlatform skips detect, flags, and interactive=false", () => {
  assert.equal(shouldPromptPlatform("detect", ["--client", "claude"], { interactive: true }), false);
  assert.equal(shouldPromptPlatform("all", ["--profile", "hosted"], { interactive: true }), false);
  assert.equal(shouldPromptPlatform("all", ["--yaaif-url", "https://x.example"], { interactive: true }), false);
  assert.equal(shouldPromptPlatform("all", ["--client", "claude"], { interactive: false }), false);
  assert.equal(shouldPromptPlatform("all", ["--client", "claude"], { interactive: true, env: { CI: "true" } }), true);
  assert.equal(shouldPromptPlatform("all", ["--client", "claude"], { env: { CI: "true" } }), false);
});

test("chooseDetectedProfile keeps existing, then hosted, then local-hybrid, then local, else hosted", () => {
  const none: ProbeMap = { hosted: false, "local-hybrid": false, local: false };
  assert.deepEqual(chooseDetectedProfile({ existingId: "local", reachable: none }), {
    profile_id: "local",
    kept_existing: true,
    reason: "existing_active_profile",
  });
  assert.deepEqual(chooseDetectedProfile({ reachable: { ...none, hosted: true, local: true } }), {
    profile_id: "hosted",
    kept_existing: false,
    reason: "reachable_hosted",
  });
  assert.deepEqual(chooseDetectedProfile({ reachable: { ...none, "local-hybrid": true, local: true } }), {
    profile_id: "local-hybrid",
    kept_existing: false,
    reason: "reachable_local-hybrid",
  });
  assert.deepEqual(chooseDetectedProfile({ reachable: { ...none, local: true } }), {
    profile_id: "local",
    kept_existing: false,
    reason: "reachable_local",
  });
  assert.deepEqual(chooseDetectedProfile({ reachable: none }), {
    profile_id: "hosted",
    kept_existing: false,
    reason: "default_hosted_unreachable",
  });
});

test("detectDefaultProfile does not overwrite an existing active profile", async () => {
  const home = await mkdtemp(join(tmpdir(), "yaaif-setup-"));
  try {
    const store = new ProfileStore(home);
    await store.setActive("local-hybrid");
    let probed = 0;
    const result = await detectDefaultProfile(store, {
      probe: async () => {
        probed += 1;
        return true;
      },
    });
    assert.equal(result.profile_id, "local-hybrid");
    assert.equal(result.kept_existing, true);
    assert.equal(result.reason, "existing_active_profile");
    assert.equal(probed, 0);
    const active = await store.getActive();
    assert.equal(active?.profile_id, "local-hybrid");
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("detectDefaultProfile ranks hosted over local when nothing is stored", async () => {
  const home = await mkdtemp(join(tmpdir(), "yaaif-setup-"));
  try {
    const store = new ProfileStore(home);
    const seen: string[] = [];
    const result = await detectDefaultProfile(store, {
      probe: async (id) => {
        seen.push(id);
        return id === "hosted" || id === "local";
      },
    });
    assert.equal(result.profile_id, "hosted");
    assert.equal(result.kept_existing, false);
    assert.equal(result.reachable.hosted, true);
    assert.deepEqual(seen, ["hosted", "local-hybrid", "local"]);
    assert.equal(await readFile(join(home, "active-profile.json"), "utf8").catch(() => ""), "");
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("loginSkippedByEnv honors installer and CI flags", () => {
  assert.equal(loginSkippedByEnv({}), false);
  assert.equal(loginSkippedByEnv({ YAAIF_INSTALLER_NO_LOGIN: "1" }), true);
  assert.equal(loginSkippedByEnv({ YAAIF_INSTALLER_NO_OPEN: "1" }), true);
  assert.equal(loginSkippedByEnv({ CI: "true" }), true);
  assert.equal(loginSkippedByEnv({}, { noLogin: true }), true);
  assert.equal(loginSkippedByEnv({}, { argv: ["--install", "--no-login"] }), true);
});

test("runInstallerSetup skips login via noLogin option without mutating env", async () => {
  const home = await mkdtemp(join(tmpdir(), "yaaif-setup-"));
  const prevHome = process.env.YAAIF_CURSOR_HOME;
  const prevLogin = process.env.YAAIF_INSTALLER_NO_LOGIN;
  delete process.env.YAAIF_INSTALLER_NO_LOGIN;
  process.env.YAAIF_CURSOR_HOME = home;
  try {
    const code = await runInstallerSetup("all", {
      argv: ["--client", "cursor"],
      probe: async () => false,
      noLogin: true,
      interactive: false,
    });
    assert.equal(code, 0);
    assert.equal(process.env.YAAIF_INSTALLER_NO_LOGIN, undefined);
    const status = JSON.parse(await readFile(join(home, "setup-status.json"), "utf8")) as { login: string };
    assert.equal(status.login, "skipped");
  } finally {
    if (prevHome === undefined) delete process.env.YAAIF_CURSOR_HOME;
    else process.env.YAAIF_CURSOR_HOME = prevHome;
    if (prevLogin === undefined) delete process.env.YAAIF_INSTALLER_NO_LOGIN;
    else process.env.YAAIF_INSTALLER_NO_LOGIN = prevLogin;
    await rm(home, { recursive: true, force: true });
  }
});

test("runInstallerSetup all writes hosted profile and skips login when NO_LOGIN=1", async () => {
  const home = await mkdtemp(join(tmpdir(), "yaaif-setup-"));
  const prevHome = process.env.YAAIF_CURSOR_HOME;
  const prevLogin = process.env.YAAIF_INSTALLER_NO_LOGIN;
  process.env.YAAIF_CURSOR_HOME = home;
  process.env.YAAIF_INSTALLER_NO_LOGIN = "1";
  try {
    const code = await runInstallerSetup("all", {
      argv: ["--client", "cursor"],
      probe: async () => false,
      interactive: false,
    });
    assert.equal(code, 0);
    const active = JSON.parse(await readFile(join(home, "active-profile.json"), "utf8")) as { profile_id: string };
    assert.equal(active.profile_id, "hosted");
    const status = JSON.parse(await readFile(join(home, "setup-status.json"), "utf8")) as { login: string };
    assert.equal(status.login, "skipped");
  } finally {
    if (prevHome === undefined) delete process.env.YAAIF_CURSOR_HOME;
    else process.env.YAAIF_CURSOR_HOME = prevHome;
    if (prevLogin === undefined) delete process.env.YAAIF_INSTALLER_NO_LOGIN;
    else process.env.YAAIF_INSTALLER_NO_LOGIN = prevLogin;
    await rm(home, { recursive: true, force: true });
  }
});

test("runInstallerSetup --yaaif-url activates a custom profile", async () => {
  const home = await mkdtemp(join(tmpdir(), "yaaif-setup-"));
  const prevHome = process.env.YAAIF_CLAUDE_HOME;
  process.env.YAAIF_CLAUDE_HOME = home;
  try {
    const code = await runInstallerSetup("all", {
      argv: ["--client", "claude", "--yaaif-url", "https://yaaif.acme.example"],
      probe: async () => false,
      noLogin: true,
      interactive: false,
    });
    assert.equal(code, 0);
    const active = JSON.parse(await readFile(join(home, "active-profile.json"), "utf8")) as { profile_id: string };
    assert.equal(active.profile_id, "yaaif-acme-example");
    const custom = JSON.parse(await readFile(join(home, "profiles.json"), "utf8")) as {
      profiles: { id: string; api_base_url: string; oidc_authority: string }[];
    };
    assert.equal(custom.profiles[0].api_base_url, "https://yaaif.acme.example");
    assert.equal(custom.profiles[0].oidc_authority, "https://yaaif.acme.example/auth/realms/yaaif");
  } finally {
    if (prevHome === undefined) delete process.env.YAAIF_CLAUDE_HOME;
    else process.env.YAAIF_CLAUDE_HOME = prevHome;
    await rm(home, { recursive: true, force: true });
  }
});

test("runInstallerSetup prompt can choose hosted or a custom URL", async () => {
  const home = await mkdtemp(join(tmpdir(), "yaaif-setup-"));
  const prevHome = process.env.YAAIF_CLAUDE_HOME;
  process.env.YAAIF_CLAUDE_HOME = home;
  try {
    const hosted = await runInstallerSetup("all", {
      argv: ["--client", "claude"],
      noLogin: true,
      interactive: true,
      prompt: async () => ({ action: "hosted" }),
    });
    assert.equal(hosted, 0);
    assert.equal(
      JSON.parse(await readFile(join(home, "active-profile.json"), "utf8")).profile_id,
      "hosted",
    );

    const custom = await runInstallerSetup("all", {
      argv: ["--client", "claude"],
      noLogin: true,
      interactive: true,
      prompt: async () => ({ action: "url", url: "https://platform.partner.test" }),
    });
    assert.equal(custom, 0);
    assert.equal(
      JSON.parse(await readFile(join(home, "active-profile.json"), "utf8")).profile_id,
      "platform-partner-test",
    );
  } finally {
    if (prevHome === undefined) delete process.env.YAAIF_CLAUDE_HOME;
    else process.env.YAAIF_CLAUDE_HOME = prevHome;
    await rm(home, { recursive: true, force: true });
  }
});
