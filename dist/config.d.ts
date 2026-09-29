export type BridgeClient = "cursor" | "vscode" | "intellij" | "codex" | "claude" | "opencode";
export type ClientDescriptor = {
    id: BridgeClient;
    label: "Cursor" | "VS Code" | "IntelliJ IDEA" | "Codex" | "Claude Code" | "OpenCode";
    oidcClientId: string;
    stateHomeEnv: string;
    stateHomeSuffix: string;
    updatedBy: string;
};
/** Per-user OpenCode workspace: <root>/<subject>/... Default root is /projects/users. */
export declare function opencodeWorkspaceSubject(cwd: string): string | undefined;
export declare function opencodeStateHome(subject: string): string;
export type Config = {
    client: ClientDescriptor;
    oidcAuthority: string;
    oidcClientId: string;
    oidcScopes: string[];
    apiBaseUrl: string;
    agentBaseUrl: string;
    controlPlaneBaseUrl: string;
    approvalBaseUrl: string;
    /** Product docs. Defaults to `{apiBaseUrl}/doc-service`. */
    docsBaseUrl: string;
    defaultTenantId: string;
    stateHome: string;
    /** Active named profile id (hosted | local-hybrid | local | custom). */
    activeProfileId: string;
    /** Extra CA PEM file for corporate / Traefik mTLS trust. */
    extraCaFile: string;
    /** Client certificate PEM for mTLS (optional). */
    clientCertFile: string;
    /** Client private key PEM for mTLS (optional). */
    clientKeyFile: string;
};
export declare function clientDescriptor(client: BridgeClient): ClientDescriptor;
export declare function parseBridgeClient(argv?: string[]): ClientDescriptor;
/** Explicit `YAAIF_DOCS_BASE_URL`, otherwise the docs UI on the platform host. */
export declare function resolveDocsBaseUrl(apiBaseUrl: string): string;
export declare function loadConfig(client?: ClientDescriptor): Config;
