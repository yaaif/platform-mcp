export type TenantMembership = {
    tenant_id: string;
    tenant_name: string;
    role?: string;
    status?: string;
    active?: boolean;
};
export type NormalizedTenant = {
    id: string;
    name: string;
    slug: string;
    role?: string;
    status?: string;
    active?: boolean;
    is_last: boolean;
    is_selected: boolean;
};
export declare function parseTenantMemberships(raw: unknown): TenantMembership[];
export declare function normalizeTenants(memberships: TenantMembership[], opts?: {
    selectedTenantId?: string;
    lastTenantId?: string;
}): NormalizedTenant[];
/** Resolve tenant by uuid, exact name, slug, or unique substring. */
export declare function resolveTenant(memberships: TenantMembership[], query: string): {
    tenant: TenantMembership;
} | {
    error: string;
    candidates?: TenantMembership[];
};
export declare function parseLastTenantId(raw: unknown): string;
