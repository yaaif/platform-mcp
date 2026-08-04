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
};
export declare function loadConfig(): Config;
