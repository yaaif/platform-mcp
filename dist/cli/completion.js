const COMMANDS = "setup auth whoami profile tenant features doctor catalog agents skills mcp ambient specs approvals wiki updates copy tools plugins completion";
const GLOBAL_OPTIONS = "--json --table --help --version";
export function completionScript(shell) {
    if (shell === "bash")
        return `# yaaif Bash completion; source with: source <(yaaif completion bash)
_yaaif_complete() {
  local current previous command
  current="\${COMP_WORDS[COMP_CWORD]}"
  previous="\${COMP_WORDS[COMP_CWORD-1]}"
  command="\${COMP_WORDS[1]}"
  if [[ "\${current}" == -* ]]; then
    COMPREPLY=( $(compgen -W "${GLOBAL_OPTIONS}" -- "\${current}") )
    return
  fi
  if [[ \${COMP_CWORD} -eq 1 ]]; then
    COMPREPLY=( $(compgen -W "${COMMANDS}" -- "\${current}") )
    return
  fi
  case "\${command}" in
    auth) COMPREPLY=( $(compgen -W "login status logout" -- "\${current}") ) ;;
    profile) COMPREPLY=( $(compgen -W "list use save delete export import" -- "\${current}") ) ;;
    tenant) COMPREPLY=( $(compgen -W "list use" -- "\${current}") ) ;;
    catalog) COMPREPLY=( $(compgen -W "overview" -- "\${current}") ) ;;
    agents|skills|specs) COMPREPLY=( $(compgen -W "list get" -- "\${current}") ) ;;
    mcp) COMPREPLY=( $(compgen -W "servers tools deployments" -- "\${current}") ) ;;
    ambient) COMPREPLY=( $(compgen -W "agents workflows runs" -- "\${current}") ) ;;
    approvals) COMPREPLY=( $(compgen -W "strategies" -- "\${current}") ) ;;
    wiki) COMPREPLY=( $(compgen -W "search get graph common proposals rebuilds" -- "\${current}") ) ;;
    updates) COMPREPLY=( $(compgen -W "status jobs" -- "\${current}") ) ;;
    copy) COMPREPLY=( $(compgen -W "scenario skill workflow mcp-server agent catalog" -- "\${current}") ) ;;
    tools) COMPREPLY=( $(compgen -W "list describe call" -- "\${current}") ) ;;
    plugins) COMPREPLY=( $(compgen -W "list check install update" -- "\${current}") ) ;;
    completion) COMPREPLY=( $(compgen -W "bash zsh fish" -- "\${current}") ) ;;
  esac
}
complete -F _yaaif_complete yaaif
`;
    if (shell === "zsh")
        return `#compdef yaaif
# yaaif Zsh completion; source with: source <(yaaif completion zsh)
_yaaif() {
  local -a commands
  _arguments '--json[emit structured JSON]' '--table[render a table]' '--version[print version]' '--help[show help]'
  commands=(${COMMANDS})
  if (( CURRENT == 2 )); then
    _describe 'command' commands
    return
  fi
  case "\${words[2]}" in
    auth) _values 'action' login status logout ;;
    profile) _values 'action' list use save delete export import ;;
    tenant) _values 'action' list use ;;
    catalog) _values 'action' overview ;;
    agents|skills|specs) _values 'action' list get ;;
    mcp) _values 'resource' servers tools deployments ;;
    ambient) _values 'resource' agents workflows runs ;;
    approvals) _values 'resource' strategies ;;
    wiki) _values 'action' search get graph common proposals rebuilds ;;
    updates) _values 'action' status jobs ;;
    copy) _values 'action' scenario skill workflow mcp-server agent catalog ;;
    tools) _values 'action' list describe call ;;
    plugins) _values 'action' list check install update ;;
    completion) _values 'shell' bash zsh fish ;;
  esac
}
_yaaif "$@"
`;
    return `# yaaif Fish completion; source with: yaaif completion fish | source
complete -c yaaif -n '__fish_use_subcommand' -a '${COMMANDS}'
complete -c yaaif -n '__fish_use_subcommand' -l json -d 'Emit structured JSON'
complete -c yaaif -n '__fish_use_subcommand' -l table -d 'Render structured results as a table'
complete -c yaaif -n '__fish_use_subcommand' -l version -d 'Print version'
complete -c yaaif -n '__fish_seen_subcommand_from auth' -a 'login status logout'
complete -c yaaif -n '__fish_seen_subcommand_from profile' -a 'list use save delete export import'
complete -c yaaif -n '__fish_seen_subcommand_from tenant' -a 'list use'
complete -c yaaif -n '__fish_seen_subcommand_from catalog' -a 'overview'
complete -c yaaif -n '__fish_seen_subcommand_from agents skills specs' -a 'list get'
complete -c yaaif -n '__fish_seen_subcommand_from mcp' -a 'servers tools deployments'
complete -c yaaif -n '__fish_seen_subcommand_from ambient' -a 'agents workflows runs'
complete -c yaaif -n '__fish_seen_subcommand_from approvals' -a 'strategies'
complete -c yaaif -n '__fish_seen_subcommand_from wiki' -a 'search get graph common proposals rebuilds'
complete -c yaaif -n '__fish_seen_subcommand_from updates' -a 'status jobs'
complete -c yaaif -n '__fish_seen_subcommand_from copy' -a 'scenario skill workflow mcp-server agent catalog'
complete -c yaaif -n '__fish_seen_subcommand_from tools' -a 'list describe call'
complete -c yaaif -n '__fish_seen_subcommand_from plugins' -a 'list check install update'
complete -c yaaif -n '__fish_seen_subcommand_from completion' -a 'bash zsh fish'
`;
}
