export const HELP = `YAAIF terminal client

Usage: yaaif [--json] <command> [options]

Session:
  setup [--yaaif-url URL | --profile ID] [--device] [--no-login]
  auth login [--device] | status | logout [--end-session]
  whoami
  profile list | use ID | save ID --yaaif-url URL | delete ID | export [--out FILE]
  profile import FILE [--activate ID] [--yes]
  profile clone SOURCE_ID DEST_ID [--label LABEL] [--activate]
  copy scenario SPEC_ID --from PROFILE --to PROFILE [--new-slug SLUG] [--revision N] [--dry-run | --yes]
  copy skill SKILL_ID --from PROFILE --to PROFILE [--new-id ID] [--dry-run | --yes]
  copy workflow WORKFLOW_ID --from PROFILE --to PROFILE [--new-name NAME] [--ambient-agent-id ID] [--dry-run | --yes]
  copy mcp-server SERVER_ID --from PROFILE --to PROFILE [--new-name NAME] [--new-endpoint URL] [--dry-run | --yes]
  copy agent AGENT_ID --from PROFILE --to PROFILE [--new-name NAME] [--dry-run | --yes]
  copy catalog --from PROFILE --to PROFILE [--skills IDS] [--agents IDS] [--ambient-agents IDS] [--workflows IDS] [--mcp-servers IDS] [--scenarios IDS] [--workflow-agent-id ID] [--ambient-agent-id ID] [--dry-run | --yes]
  tenant list | use TENANT
  features
  doctor [--login]

Catalog (read-only conveniences):
  catalog overview
  agents list | get ID
  skills list | get ID
  mcp servers | tools | deployments list
  ambient agents | workflows | runs list
  specs list | get ID
  approvals strategies list
  wiki search [QUERY] | get SLUG | graph | common
  wiki proposals list | get ID
  wiki rebuilds preview | latest | list | get ID
  updates status | jobs list | jobs get ID

Full MCP tool contract:
  tools list [FILTER]
  tools describe TOOL
  tools call TOOL [--args JSON | --args @FILE | --args -]

Integrations:
  plugins list
  plugins check --client CLIENT [--plugin-src DIR] [--online]
  plugins install CLIENT [--plugin-src DIR] [installer options] [--dry-run]
  plugins update CLIENT [--plugin-src DIR] [--force] [--keep-old-versions] [--dry-run]
  completion bash | zsh | fish

Global options:
  --json       Emit structured JSON
  --table      Render structured results as tables
  --version    Print the CLI/bridge version
  -h, --help   Show this help

Use @FILE or '-' for credential-bearing tool arguments to avoid shell history.
CLI state and tokens are stored separately in ~/.yaaif/cli (YAAIF_CLI_HOME).
Host installation and upgrades remain in yaaifctl/yaaif-demo.
`;
