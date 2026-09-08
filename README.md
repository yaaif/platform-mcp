# @yaaif/platform-mcp

Stdio MCP bridge and Node installer for the YAAIF **Cursor**, **Claude Code**, and **Codex** plugins.

Plugin contract **1.3.0**. This package **1.3.2**. Each IDE keeps its own login state and OIDC client.

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
| **npm package** | `@yaaif/platform-mcp@1.3.2` must be **Published** (`npm view @yaaif/platform-mcp version`) | All |
| **Git** | Clone Cursor plugin; Claude/Codex marketplace add clones GitHub | Cursor always; Claude/Codex marketplace |
| **Browser** | OIDC PKCE sign-in | All |
| **Cursor Desktop** | Plugins + MCP | Cursor |
| **Claude Code** | Desktop and/or `claude` CLI | Claude |
| **Codex** | App/CLI with local marketplaces | Codex |
| **YAAIF user** | Platform **`DEVELOPER`** role on the target tenant | All |
| **Network** | npm, GitHub, and the YAAIF host | All |

**Operator (once per environment):** enable public Keycloak clients `yaaif-cursor`, `yaaif-claude`, and `yaaif-codex` (PKCE, no client secret).

**Not required:** Go/Python/Docker, native `.pkg` / `.msi` / `.deb` installers, S2S secrets, desktop connection keys, or AI-gateway keys.

Run `npx` from your **home directory**, not from `packages/mcp` (that path fails with `yaaif-platform-mcp: command not found`).

```bash
cd ~
```

## Shared installer

The CLI asks you to choose hosted `https://platform.yaaif.ai` or another YAAIF URL.

```bash
npx -y @yaaif/platform-mcp@1.3.2 --install --client cursor|claude|codex
```

Non-interactive:

```bash
npx -y @yaaif/platform-mcp@1.3.2 --install --client claude --yaaif-url https://your.yaaif.host
npx -y @yaaif/platform-mcp@1.3.2 --install --client cursor --profile hosted --plugin-src ./cursor-plugin
```

`--no-login` skips the browser. `--offline` pins absolute `node` + `cli.js` for Claude/Codex (Cursor always uses absolute `node` + `cli.js`). `--force` overwrites a newer Cursor dest. `--cli-path` is required if the running CLI lives under an `npx` cache.

### Air-gap

On a machine with npm: `npm pack @yaaif/platform-mcp@1.3.2`. Copy the `.tgz` plus the plugin clone.

```bash
npm install -g ./yaaif-platform-mcp-1.3.2.tgz
yaaif-platform-mcp --install --client cursor|claude|codex --plugin-src <dir> --offline
```

---

## Cursor — end to end

1. **Install profile and copy plugin files**

   ```bash
   cd ~
   git clone https://github.com/yaaif/cursor-plugin.git
   npx -y @yaaif/platform-mcp@1.3.2 --install --client cursor --plugin-src ./cursor-plugin
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
   npx -y @yaaif/platform-mcp@1.3.2 --install --client claude
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

MCP start command: `npx -y @yaaif/platform-mcp@1.3.2 --client claude`.

---

## Codex — end to end

1. **Sign in** (does not add the plugin)

   ```bash
   cd ~
   npx -y @yaaif/platform-mcp@1.3.2 --install --client codex
   ```

2. **Add marketplace and install plugin (required)**

   ```bash
   git clone https://github.com/yaaif/codex-plugin.git
   ```

   In Codex, add the clone as a local marketplace named **`yaaif`**, install **YAAIF** (`yaaif-platform`), then start a **new** task.

3. **Verify**  
   `$yaaif-login` then `$yaaif-doctor`. Codex has no `userConfig` and no `commands/`; short names are alias skills.

MCP start command: `npx -y @yaaif/platform-mcp@1.3.2 --client codex`.

---

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
