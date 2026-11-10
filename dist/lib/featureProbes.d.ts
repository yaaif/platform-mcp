import type { ApiClient } from "../client/http.js";
export type FeatureStatus = "available" | "permission_denied" | "unavailable" | "error";
export type FeatureId = "agents" | "scenarios" | "credentials" | "wiki" | "platform_updates";
export type FeatureCapability = {
    status: FeatureStatus;
    supported: boolean;
    accessible: boolean;
    permission: string;
    http_status?: number;
    error?: string;
    hint?: string;
};
export declare function probeFeature(api: ApiClient, id: FeatureId): Promise<FeatureCapability>;
export declare function collectFeatureCapabilities(api: ApiClient): Promise<{
    all_supported: boolean;
    all_accessible: boolean;
    features: Record<FeatureId, FeatureCapability>;
}>;
