export type BridgeClient = "cursor" | "codex" | "claude";
export type ClientDescriptor = {
    id: BridgeClient;
    label: "Cursor" | "Codex" | "Claude Code";
    oidcClientId: string;
    stateHomeEnv: string;
    stateHomeSuffix: string;
    updatedBy: string;
};
export type Config = {
    client: ClientDescriptor;
    oidcAuthority: string;
    oidcClientId: string;
    oidcScopes: string[];
    apiBaseUrl: string;
    agentBaseUrl: string;
    controlPlaneBaseUrl: string;
    approvalBaseUrl: string;
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
export declare function loadConfig(client?: ClientDescriptor): Config;
