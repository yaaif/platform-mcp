# @yaaif/platform-mcp

Stdio MCP bridge used by the YAA\F Cursor and Codex plugins. The selected client
controls its OIDC default, wording, audit identity, and local state directory.

```bash
npm install
npm run build
node dist/cli.js --client codex
```

Or via npx after publish:

```bash
npx -y @yaaif/platform-mcp@1.2.0 --client codex
```

Use `--client cursor` for the backwards-compatible Cursor integration. Codex
state is stored beneath `~/.yaaif/codex`; Cursor state remains beneath
`~/.yaaif/cursor`.
