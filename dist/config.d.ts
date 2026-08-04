export type Config = {
    oidcAuthority: string;
    oidcClientId: string;
    oidcScopes: string[];
    apiBaseUrl: string;
    agentBaseUrl: string;
    controlPlaneBaseUrl: string;
    approvalBaseUrl: string;
    defaultTenantId: string;
    cursorHome: string;
    /** Active named profile id (hosted | local-hybrid | local | custom). */
    activeProfileId: string;
    /** Extra CA PEM file for corporate / Traefik mTLS trust. */
    extraCaFile: string;
    /** Client certificate PEM for mTLS (optional). */
    clientCertFile: string;
    /** Client private key PEM for mTLS (optional). */
    clientKeyFile: string;
};
export declare function loadConfig(): Config;
