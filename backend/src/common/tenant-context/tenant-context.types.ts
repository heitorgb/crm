export interface TenantContext {
  tenantId: string;
  userId: string;
  membershipId: string;
  role: string;
}

export interface RequestContextStore {
  requestId?: string;
  tenant?: TenantContext;
}
