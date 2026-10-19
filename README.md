# @yaaif/platform-mcp

Stdio MCP bridge and Node installer for the YAAIF **Cursor**, **VS Code**, **IntelliJ IDEA**, **Claude Code**, **Codex**, and **OpenCode** plugins.

Plugin contract **1.4.0**. This package **1.3.7**. Each IDE keeps its own login state and OIDC client.

`--install` writes the platform profile and (for Cursor) copies plugin files. It does **not** register the plugin in the IDE. Finish in Cursor / Claude / Codex after the CLI exits.

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
| **npm package** | `@yaaif/platform-mcp@1.3.7` must be **Published** (`npm view @yaaif/platform-mcp version`) | All |
| **Git** | Clone Cursor plugin; Claude/Codex marketplace add clones GitHub | Cursor always; Claude/Codex marketplace |
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

The CLI asks you to choose hosted `https://platform.yaaif.ai` or another YAAIF URL.

```bash
npx -y @yaaif/platform-mcp@1.3.7 --install --client cursor|vscode|intellij|claude|codex|opencode
```

Non-interactive:

```bash
npx -y @yaaif/platform-mcp@1.3.7 --install --client claude --yaaif-url https://your.yaaif.host
npx -y @yaaif/platform-mcp@1.3.7 --install --client cursor --profile hosted --plugin-src ./cursor-plugin
```

`--no-login` skips the browser. `--offline` pins absolute `node` + `cli.js` for Claude/Codex (Cursor always uses absolute `node` + `cli.js`). `--force` overwrites a newer Cursor dest. `--cli-path` is required if the running CLI lives under an `npx` cache.

### Air-gap

On a machine with npm: `npm pack @yaaif/platform-mcp@1.3.7`. Copy the `.tgz` plus the plugin clone.

```bash
npm install -g ./yaaif-platform-mcp-1.3.7.tgz
yaaif-platform-mcp --install --client cursor|claude|codex --plugin-src <dir> --offline
```

---

## Cursor — end to end

1. **Install profile and copy plugin files**

   ```bash
   cd ~
   git clone https://github.com/yaaif/cursor-plugin.git
   npx -y @yaaif/platform-mcp@1.3.7 --install --client cursor --plugin-src ./cursor-plugin
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

1. **Sign in** (does not add the plugin)

   ```bash
   cd ~
   npx -y @yaaif/platform-mcp@1.3.7 --install --client claude
   ```

2. **Add marketplace and install plugin (required)**

   ```bash
   claude plugin marketplace add yaaif/claude-plugin
   claude plugin install yaaif-platform@yaaif
   ```

   Or **Customize → Plugins → Add** → GitHub `yaaif/claude-plugin` → install **`yaaif-platform`**. Do not search for `yaaif/yaaif-platform`.

   Local only: `claude plugin marketplace add /path/to/claude-plugin` or `claude --plugin-dir /path/to/claude-plugin`.

3. **New session**  
   Quit Claude Code, open a new session, optionally `/plugin configure yaaif-platform@yaaif`, then `/yaaif-platform:yaaif-login` and `/yaaif-platform:yaaif-doctor`.

MCP start command: `npx -y @yaaif/platform-mcp@1.3.7 --client claude`.

---

## Codex — end to end

1. **Sign in** (does not add the plugin)

   ```bash
   cd ~
   npx -y @yaaif/platform-mcp@1.3.7 --install --client codex
   ```

2. **Add marketplace and install plugin (required)**

   ```bash
   git clone https://github.com/yaaif/codex-plugin.git
   ```

   In Codex, add the clone as a local marketplace named **`yaaif`**, install **YAAIF** (`yaaif-platform`), then start a **new** task.

3. **Verify**  
   `$yaaif-login` then `$yaaif-doctor`. Codex has no `userConfig` and no `commands/`; short names are alias skills.

MCP start command: `npx -y @yaaif/platform-mcp@1.3.7 --client codex`.

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

Optional `YAAIF_EXTRA_CA_FILE` for a local/corporate CA. Tokens stay in `~/.yaaif/<ide>/session.json` (`0600`). Do not commit that directory.

## Local development

```bash
npm install
npm test
npm run build
node dist/cli.js --client cursor
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

Prepared versions: bridge **1.3.8**, Cursor/Codex/Claude plugins **1.3.3**, VS Code/JetBrains **0.2.0**. Publish the bridge before installing plugin configurations that reference its new npm pin. No release is published by building this checkout.

For isolated MCP transport smoke tests after building:

```bash
YAAIF_GOVERNANCE_SMOKE=1 node --import tsx --test src/integration/governanceBridge.integration.test.ts
```

These six-client tests use fresh unauthenticated state. Signed-in tenant and native IDE interaction smoke tests remain release checks.
