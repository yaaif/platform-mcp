# @yaaif/platform-mcp

Stdio MCP bridge and Node installer for the YAAIF **Cursor**, **VS Code**, **IntelliJ IDEA**, **Claude Code**, **Codex**, and **OpenCode** plugins.

Plugin contract **1.7.0**. This package **1.7.0**. Each IDE keeps its own login state and OIDC client.

`--install` writes the platform profile and (for Cursor) copies plugin files. It does **not** register the plugin in the IDE. Finish in Cursor / Claude / Codex after the CLI exits.

## YAAIF terminal CLI

The same package installs `yaaif`, a terminal/CI client with separate state in `~/.yaaif/cli` and the public `yaaif-cli` OIDC client. It does not replace `yaaifctl` or `yaaif-demo` host lifecycle commands.

```bash
npm install -g @yaaif/platform-mcp@1.7.0
yaaif setup --yaaif-url https://platform.yaaif.local --device
yaaif tenant list
yaaif doctor --json
yaaif features --json
yaaif agents list --limit 10
yaaif wiki search "release policy" --scope common
yaaif wiki rebuilds latest
yaaif updates status
yaaif updates jobs list --limit 5
yaaif tools list credential
yaaif tools describe yaaif_credential_create
yaaif tools call yaaif_credential_list --args '{}'
```

`yaaif tools call` invokes the exact registered MCP tools and schemas used by every IDE. Use `--args @request.json` or `--args -` for secret-bearing arguments instead of placing values in shell history. Common read-only resource commands are conveniences over those same tools.

Default text output is unchanged. Add `--table` for compact tables from feature maps, catalog items, doctor checks and scalar statuses, or `--json` for stable automation output; the two options are mutually exclusive.

Enable shell completion:

```bash
# Bash
source <(yaaif completion bash)
# Zsh
source <(yaaif completion zsh)
# Fish
yaaif completion fish | source
```

Wiki tools cover pages, graph, Common status, proposals and rebuild inspection. Platform-update tools cover current status and release jobs. Both families are read-only: page/proposal decisions, rebuild start/cancel, release checks, job cancellation and upgrades remain in their authorized Admin UI or installer surfaces. OpenCode exposes a bounded subset of these reads to respect its tool budget.

`yaaif_features` probes agents, Scenarios, Credentials, Wiki and platform updates with GET-only requests. `available` means the route and caller access work, `permission_denied` means the backend supports the feature but the caller lacks its named permission, `unavailable` means the backend needs an upgrade, and `error` indicates a transport/service failure. Doctor includes the same `feature_*` checks.

Plugin lifecycle commands are `yaaif plugins list`, `check`, `install`, and `update`. Use `--plugin-src` for a source override or offline install; marketplace-managed IDEs report their native update action. `plugins check --online` additionally compares npm metadata, while offline checks inspect local manifests and launch commands.

For an existing platform, provision the CLI's PKCE/device-grant client with `scripts/keycloak/ensure-yaaif-ide-client.sh cli`. Fresh realm imports already include it.

| IDE | Plugin repo | Marketplace | Plugin ID | State directory | OIDC client |
| --- | --- | --- | --- | --- | --- |
| **Cursor** | [yaaif/cursor-plugin](https://github.com/yaaif/cursor-plugin) | `yaaif` | `yaaif` | `~/.yaaif/cursor` | `yaaif-cursor` |
| **Claude Code** | [yaaif/claude-plugin](https://github.com/yaaif/claude-plugin) | `yaaif` | `yaaif-platform` | `~/.yaaif/claude` | `yaaif-claude` |
| **Codex** | [yaaif/codex-plugin](https://github.com/yaaif/codex-plugin) | `yaaif` | `yaaif-platform` | `~/.yaaif/codex` | `yaaif-codex` |

## Dependencies

Install these on the **same OS** as the IDE (do not mix WSL Node with Windows Cursor).

| Dependency | Requirement | Who |
| --- | --- | --- |
| **Node.js** | ≥ 20 (`node -v`). Provides `npx`. | All |
| **npm package** | `@yaaif/platform-mcp@1.7.0` must be **Published** (`npm view @yaaif/platform-mcp version`) | All |
| **Git** | Optional local development checkout or marketplace source | Optional; npx downloads tagged sources automatically |
| **Java** | 21+ for the IntelliJ build; Gradle wrapper is included | IntelliJ only |
| **`code` CLI** | Installs the generated VSIX; otherwise use the printed manual path | VS Code optional |
| **Browser** | OIDC PKCE sign-in | All |
| **Cursor Desktop** | Plugins + MCP | Cursor |
| **Claude Code** | Desktop and/or `claude` CLI | Claude |
| **Codex** | App/CLI with local marketplaces | Codex |
| **YAAIF user** | Platform **`DEVELOPER`** role on the target tenant | All |
| **Network** | npm, GitHub, and the YAAIF host | All |

**Operator (once per environment):** enable public Keycloak clients `yaaif-cursor`, `yaaif-claude`, and `yaaif-codex` (PKCE, no client secret).

**Not required:** Go/Python/Docker, native `.pkg` / `.msi` / `.deb` installers, S2S secrets, desktop connection keys, or AI-gateway keys.

Run `npx` from your **home directory**, not from a checkout of this repo (that path fails with `yaaif-platform-mcp: command not found`).

```bash
cd ~
```

## Shared installer

The CLI asks you to choose hosted `https://platform.yaaif.ai` or another YAAIF URL. Cursor, Claude Code, Codex, VS Code, and IntelliJ automatically download the plugin source tagged `v1.7.0`, matching the platform and bridge versions. VS Code builds/installs a VSIX; IntelliJ builds/installs a jar with its bundled Gradle wrapper.

```bash
npx -y @yaaif/platform-mcp@1.7.0 --install --client cursor|vscode|intellij|claude|codex|opencode
```

Non-interactive:

```bash
npx -y @yaaif/platform-mcp@1.7.0 --install --client claude --yaaif-url https://your.yaaif.host
npx -y @yaaif/platform-mcp@1.7.0 --install --client cursor --profile hosted
```

`--no-login` skips the browser. The installer stages the self-contained bridge under `~/.yaaif/<client>/bridge/`, so Cursor does not pin a temporary npx-cache path and `--cli-path` is only an optional override. Claude/Codex managed sources stay under `~/.yaaif/<client>/plugin/` for native local registration.

Source controls: `--plugin-src DIR` uses a local checkout without downloading; `--plugin-ref REF` selects another tag/branch/commit; `--plugin-sha256 HEX` verifies the archive; `--plugin-source-base-url URL` selects an enterprise mirror. `--offline` requires `--plugin-src` and uses absolute `node` + staged bridge. `--force` overwrites a newer Cursor destination. Native controls: `--build-only` skips IDE installation and cleanup, `--code-path` overrides the VS Code CLI, `--gradle-path` overrides the IntelliJ wrapper, and `--jetbrains-plugins-dir` selects the IntelliJ installation target.

After a successful update, superseded Cursor staging directories, Claude/Codex version caches, VSIX artifacts, and IntelliJ backup jars are removed from their active locations and moved to `~/.yaaif/<client>/plugin-backups/plugin-cleanup-*`. The current version and unrelated plugins are preserved. Use `--keep-old-versions` to retain old installations instead. Cleanup runs only after install verification succeeds.

Updates are transactional: if installation or verification fails, the installer restores the previous plugin files, MCP launcher configuration, managed source, VSIX, and IntelliJ jar where backups exist, rather than leaving a partially upgraded installation. Rollback errors are reported without hiding the original failure.

Use `--dry-run` with `plugins install` or `plugins update` to print the current/target versions, source, launcher, build/install actions, and cleanup policy as JSON. Dry-run returns before downloads, profile writes, builds, cleanup, or IDE installation.

### Air-gap

On a machine with npm: `npm pack @yaaif/platform-mcp@1.7.0`. Copy the `.tgz` plus the plugin clone.

```bash
npm install -g ./yaaif-platform-mcp-1.7.0.tgz
yaaif-platform-mcp --install --client cursor|claude|codex --plugin-src <dir> --offline
```

---

## Cursor — end to end

1. **Install profile and copy plugin files**

   ```bash
   cd ~
   npx -y @yaaif/platform-mcp@1.7.0 --install --client cursor
   ```

   Choose hosted or your YAAIF URL and complete browser login.

   Dest: `~/.cursor/plugins/local/yaaif` (Windows: `%USERPROFILE%\.cursor\plugins\local\yaaif`).

2. **Register in Cursor (required)**  
   Cursor → **Plugins** → **+ Add** → **Add local plugin** → that path → **Developer: Reload Window**.

3. **Verify**  
   `/yaaif-login` then `/yaaif-doctor` until `ready: true`.

Marketplace alternative (when published): install **yaaif** from Cursor Marketplace, configure plugin variables if needed, reload, then `/yaaif-login` and `/yaaif-doctor`.

---

## Claude Code — end to end

1. **Install profile and managed plugin source**

   ```bash
   cd ~
   npx -y @yaaif/platform-mcp@1.7.0 --install --client claude
   ```

2. **Add marketplace and install plugin (required)**

   ```bash
   claude plugin marketplace add yaaif/claude-plugin
   claude plugin install yaaif-platform@yaaif
   ```

   Or **Customize → Plugins → Add** → GitHub `yaaif/claude-plugin` → install **`yaaif-platform`**. Do not search for `yaaif/yaaif-platform`.

   Managed local source: `claude --plugin-dir ~/.yaaif/claude/plugin` or add that directory as a local marketplace.

3. **New session**  
   Quit Claude Code, open a new session, optionally `/plugin configure yaaif-platform@yaaif`, then `/yaaif-platform:yaaif-login` and `/yaaif-platform:yaaif-doctor`.

MCP start command: `npx -y @yaaif/platform-mcp@1.7.0 --client claude`.

---

## Codex — end to end

1. **Install profile and managed plugin source**

   ```bash
   cd ~
   npx -y @yaaif/platform-mcp@1.7.0 --install --client codex
   ```

2. **Add marketplace and install plugin (required)**

   In Codex, add `~/.yaaif/codex/plugin` as a local marketplace named **`yaaif`**, install **YAAIF** (`yaaif-platform`), then start a **new** task.

3. **Verify**  
   `$yaaif-login` then `$yaaif-doctor`. Codex has no `userConfig` and no `commands/`; short names are alias skills.

MCP start command: `npx -y @yaaif/platform-mcp@1.7.0 --client codex`.

---

## VS Code — native install

```bash
npx -y @yaaif/platform-mcp@1.7.0 --install --client vscode
```

The installer downloads the matching source, runs `npm ci` and `npm run package`, and calls `code --install-extension` on the generated VSIX. If `code` is unavailable, install the printed path under `~/.yaaif/vscode/packages/` manually or set `--code-path`. Use `--build-only` to skip IDE modification, then reload VS Code and run **YAAIF: Configure MCP Bridge**.

## IntelliJ IDEA — native install

Requires Java 21 or later; no system Gradle is needed because the plugin includes its wrapper.

```bash
npx -y @yaaif/platform-mcp@1.7.0 --install --client intellij
```

The installer builds `yaaif-jetbrains-1.7.0-base.jar`, backs up any previous `yaaif-jetbrains.jar`, and installs into the newest detected IntelliJ plugins directory. Set `--jetbrains-plugins-dir` for a different IDE or `--gradle-path` for another Gradle executable. Use `--build-only` to skip installation, then restart IntelliJ and run **YAAIF: Configure MCP Bridge**.

---

## File generation and editing (all IDEs and OpenCode)

Four tools call the platform's file generator and manipulator, so a prompt such as "turn this table into an Excel
file", "merge these two PDFs" or "fill the invoice template" produces a real, styled file (a download card in the
session) without hand-writing bytes. They map to the agent-service local tools of the same name and are on the
OpenCode allowlist.

| Tool | Arguments | Result |
|---|---|---|
| `yaaif_file_generate` | `format` (csv, tsv, xlsx, docx, pptx, md, html, pdf), `name`, `source` (one of `markdown`, `sheets`, `outline`, `table_ref`, `file_id`), `options` | A new file |
| `yaaif_file_convert` | `file_id`, `to`, `name`, `options` | csv⇄xlsx, md→docx/pptx/html/pdf, docx/xlsx/pptx→pdf, any document→md/txt |
| `yaaif_file_transform` | `file_id`, `operations[]`, `output_name`, `sheet`, `format`, `mode` | Edited copy (filter, sort, compute, group, join; PDF merge/split/extract/rotate; docx/md section replace; xlsx cell edits) |
| `yaaif_file_fill_template` | `template_file_id`, `data`, `output_name`, `to_pdf` | Filled copy of a docx/xlsx/md template with `{{placeholders}}` and `{{#rows}}` loops |

Pass the arguments inside `arguments` and call `yaaif_dev_session_ensure` first so the files land in your authoring
session. Source files are read with the caller's file permissions; the original is never modified (`mode: "new_version"`
stores the result as the next version of the same artifact). Full reference: `agent-service/docs/file-generation.md`.

---

## File workflows (all IDEs and OpenCode)

Two tools build and install **file workflows**: ambient workflows that run when an uploaded file finishes
extraction (`file.ready`, `file.failed`, `file.review_decided`), optionally load the extracted text or
tables, run your own tool steps and reply to where the file came from (chat, Teams, Lark, email). They are
registered for every client (`cursor`, `vscode`, `intellij`, `claude`, `codex`, `opencode`) and are on the
OpenCode allowlist.

| Tool | What it does |
|---|---|
| `yaaif_file_workflow_template` | Builds the workflow definitions (one workflow + trigger rule per event) and returns the event / payload reference. Installs nothing. |
| `yaaif_file_workflow_create` | Installs them under an ambient agent (`ambient_agent_id`); `dry_run: true` previews the exact bodies. |

Options (both tools): `name`, `events`, `agent_id` or `filter_contains` (scope), `load_content`,
`load_tables`, `steps[]` (`tool_name`, `input` bindings, `output_key`), `reply`, `message_binding`, `enabled`.
Rules are per tenant and match source `file` exactly; the workflow runs as the uploader.

Ask your assistant, for example:

> Create a file workflow on ambient agent `<id>`: when a PDF from chat agent `<id>` finishes extraction, load its
> tables, call `erp_post_price_changes` with them and tell the uploader the result.

Cursor, Claude Code and Codex also ship the `yaaif-create-file-workflow` skill (command
`yaaif-new-file-workflow`) that walks through the questions and the test. Full flow and payload reference:
`agent-service/docs/file-workflows.md` in the YAAIF repository; example pack:
`examples/workflow-packs/file-intake-workflow-pack/`.

## Profiles

| Profile | When |
| --- | --- |
| **Hosted** | `https://platform.yaaif.ai` |
| **Custom URL** | Customer host, e.g. `https://yaaif.mydin.com` (OIDC `{url}/auth/realms/yaaif`) |
| **`local`** | All APIs on `https://platform.yaaif.local` |
| **`local-hybrid`** | OIDC on `.com` / tunnel, APIs on `.local` |

Optional `YAAIF_EXTRA_CA_FILE` for a local/corporate CA. Each server profile has an isolated session in `~/.yaaif/<ide>/profile-sessions/<profile-id>/session.json` (`0600`), with one-time migration from the legacy single `session.json`. Switching profiles restores that server's login and tenant when present and never reuses another server's token. Do not commit the state directory.

`yaaif profile list` shows safe authentication and tenant status for every server. `yaaif profile clone SOURCE_ID DEST_ID` copies only endpoint/TLS configuration, not credentials. `yaaif copy scenario SPEC_ID --from SOURCE --to DEST` previews a cross-server draft copy; rerun with `--yes` after review. Conflicting slugs fail safely unless `--new-slug` is provided. Bindings, release history, provenance, tenant IDs, credentials, and tokens are excluded.

Move configurations between machines with `yaaif profile export --out profiles.json` and `yaaif profile import profiles.json`. Import previews first; apply with `--yes` and optionally `--activate ID`. Bundles contain endpoint/TLS configuration only—never sessions, tokens, or secret contents—and refuse to overwrite existing profiles. MCP equivalents are `yaaif_platform_bundle_export` and `yaaif_platform_bundle_import`.

Copy complete skill packs with `yaaif copy skill SKILL_ID --from SOURCE --to DEST`. The preview lists remapped files and excluded credential/private-key material. Apply with `--yes`; destination conflicts require `--new-id`. Agent mappings, Scenario bindings, and sessions are not copied. MCP equivalent: `yaaif_skill_copy`.

Copy ambient workflows with `yaaif copy workflow WORKFLOW_ID --from SOURCE --to DEST`. The destination ambient agent must already exist (override with `--ambient-agent-id`). Graph logic is preserved, but server-specific credentials, approval strategy IDs, Scenario bindings, and run history are removed. New workflows are installed disabled with async execution and approval requirements off for review. MCP equivalent: `yaaif_ambient_workflow_copy`.

Copy external MCP connections with `yaaif copy mcp-server SERVER_ID --from SOURCE --to DEST`. Only endpoint metadata and non-secret header mappings are copied. Credential IDs, profiles, mappings, literal headers, and tool refresh calls are excluded. The result lists required credential rebinding and `refresh_required: true`. Use `--new-name` or `--new-endpoint` to avoid conflicts. MCP equivalent: `yaaif_mcp_server_copy`.

Copy agent definitions with `yaaif copy agent AGENT_ID --from SOURCE --to DEST`. Prompt, description, and agent type are preserved; skill mappings, Scenario bindings, and activation state are not. The destination agent is created disabled and lists required skill IDs for explicit remapping. MCP equivalent: `yaaif_agent_copy`.

Migrate selected resources together with `yaaif copy catalog --from SOURCE --to DEST --mcp-servers IDS --skills IDS --agents IDS --ambient-agents IDS --workflows IDS --scenarios IDS`. The plan covers every selected resource and conflict before applying in dependency order: MCP connections, skills, agents, ambient agents, workflows, then Scenarios. Any conflict aborts before writes. Sessions, credentials, bindings, and run history are excluded. MCP equivalent: `yaaif_catalog_copy`.

## Local development

```bash
npm install
npm test
npm run build
node dist/cli.js --client cursor
node dist/yaaif-cli.js --help
```

`--setup detect|profile|login|whoami|all` remains available after install.

## License

Apache-2.0

## Tenant governance

`yaaif-governance` gathers authorized tenant business context, interviews for missing requirements, diagnoses failures, and prepares guardrail/harness policy changes. It starts with effective permissions and uses a preview → explicit confirmation → apply workflow. It never grants permissions or treats tenant documents as authorization. Retention is inspection only; infrastructure, data purges and run controls are excluded.

OpenCode: `/yaaif-governance`. Cursor/Claude Code: the `yaaif-governance` command or skill. Codex: `$yaaif-governance`. VS Code/JetBrains: **YAAIF: Governance Agent** (JetBrains copies the bundled instructions for AI Assistant).

Requires a bridge and backend containing the governance tools, validation routes and conditional-write middleware. Prepare and test the packages together before publishing; do not point a live install at an unpublished version. A saved configuration does not by itself prove runtime enforcement.

### Governance tool contract

- `yaaif_governance_capabilities`: resolve the signed-in subject, tenant and effective permissions; list supported resources and actions. Permission discovery errors stop configuration.
- `yaaif_governance_inspect`: typed, paginated resource reads, including individual policies, overrides, rollouts and evaluation candidates. `dry_run` evaluates supplied samples; `replay_start` creates an evaluation job and `replay` reads its status. These evaluations do not change live policies.
- `yaaif_governance_preview`: prepare up to 20 typed operations, with one operation per target. Store the immutable owner-bound proposal under the client's private `governance-proposals` directory. Return before/requested values, field diffs, validation results, baseline, review digest and rollback guidance. Presets resolve into a concrete policy update before review. Harness validation uses the backend's update normalizer. Lifecycle commands explicitly report that derived effects are verified at apply rather than simulated.
- `yaaif_governance_apply`: requires proposal ID, review digest and `confirm=true` after the user reviews that proposal. Recheck access before every step, serialize application with an exclusive proposal lock, and send backend preconditions. Applied operations never replay. A lost response records an `uncertain` step and stops; inspect current state before proposing a remedy.
- `yaaif_governance_proposal_get`: retrieve status and verification within the original identity/profile/platform/tenant boundary and current permissions. Interrupted `applying` proposals require inspection; do not delete their lock file while another process might still be running.

Backend additions include policy/harness validation, single-record reads and `GET /api/{guardrails,harness,agents}/governance-state`. Conditional management writes send `X-Governance-If-Match` and return `X-Governance-Version`; existing policy/exception `If-Match` checks are forwarded too. API-server forwards governance preconditions and correlation headers. Management HTTP writes serialize per tenant across PostgreSQL replicas with advisory locks; the pool must permit at least two connections. Busy requests fail without applying. Fingerprints include persisted configuration, assignments and evaluation feedback, so unrelated changes within that tenant may conservatively require another preview. Direct background/database writers do not take the HTTP management lock; existing resource-level validation and version checks still apply.

Audit records use authenticated actor identity, proposal/request correlation, requested field names, body digest and outcome. Full before snapshots remain in private client state and existing policy revision storage. Read-back reports saved settings separately from runtime enforcement. Applying configuration does not prove that a representative workload passed.

Prepared versions: bridge **1.7.0**, Cursor/Codex/Claude plugins **1.7.0**, VS Code/JetBrains **1.7.0**. Publish the bridge before installing plugin configurations that reference its new npm pin. No release is published by building this checkout.

For isolated MCP transport smoke tests after building:

```bash
YAAIF_GOVERNANCE_SMOKE=1 node --import tsx --test src/integration/governanceBridge.integration.test.ts
```

These six-client tests use fresh unauthenticated state. Signed-in tenant and native IDE interaction smoke tests remain release checks.


## IDE skill scans, diagnostics, fixes and improvements

All IDE clients share `yaaif_skill_security`:

| action | behavior |
| --- | --- |
| `guide` | Read the bundled offline SkillSpector SOP; optional `topic` selects overview, triage, repair, troubleshooting, or sources. |
| `status` | Read plugin state, readiness, policy and history. |
| `scan` | Queue a saved-branch scan; optional `workspace_fingerprint` pins the reviewed workspace. |
| `report` | Read a specific asynchronous job using `scan_id`. |
| `diagnose` | Validate saved skills and optionally combine one matching-branch scan; paginate/filter normalized issues. |
| `plan` | Add a repair/improvement outline and affected-file list; `goal` records the requested improvement. |
| `fix` | Preview or conditionally update one existing file using its exact `if_match` etag. |

Start with authentication and the requested tenant. Pass the same `branch`
through diagnostics, file reads, repairs and rescans. Read a file first with
`yaaif_skill_read_file` and retain its content **etag**. `fix` defaults to a dry
run; application requires `dry_run:false` and `allow_mutating:true`. The server
checks `If-Match` atomically, protecting edits made after the preview. By default
an applied repair is followed by branch validation. A validation error after an
update returns `applied:true`; an ambiguous transport failure returns
`applied:"unknown"` and must be reconciled by reading the file before retrying.

```json
{"action":"diagnose","branch":"main","severity":"ERROR","limit":20}
```
```json
{"action":"fix","branch":"main","path":"example/SKILL.md","content":"reviewed replacement","if_match":"W/\"content-etag\"","dry_run":true}
```

Plans use real validation/security evidence; they do not generate or apply LLM
rewrites. IDE agents author the replacement content. Evidence whose workspace
fingerprint differs is explicitly historical. Neither the repair nor scan tools
change policy, accept findings, activate snapshots, publish, enable, or map
skills. Skill Security activation is required to scan, but structural validation
works independently. Read/report tools preserve structured API error codes,
file paths and bounded diagnostics rather than discarding them into truncated
HTTP strings.

`yaaif_skill_security_scan` and `yaaif_skill_security_report` remain compatible
for existing clients. OpenCode exposes the unified tool within its existing
120-tool budget. File tree/read/write/validate tools and local lifecycle aliases
now accept `branch`; the write tool also accepts `if_match`.

### SkillSpector SOP for IDE repairs

Use `yaaif_skill_security` with `action: "guide"` for bundled offline guidance,
or select a topic: `overview`, `triage`, `repair`, `troubleshooting`, `sources`.
The [SOP entry point](docs/skill-security.md) explains the source attribution,
version scope, and per-finding or whole-scan **Fix with IDE** workflow. This uses
the existing tool slot, including in OpenCode.
