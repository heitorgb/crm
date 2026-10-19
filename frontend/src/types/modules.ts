export const MODULE_KEYS = {
  ATTENDANCE: 'attendance',
  CONTACTS: 'contacts',
  BILLING_CHARGES: 'billing.charges',
  BILLING_COLLECTION: 'billing.collection',
  WEBHOOKS: 'webhooks',
} as const;

export type ModuleKey = (typeof MODULE_KEYS)[keyof typeof MODULE_KEYS];

export interface ModuleCatalogEntry {
  id: string;
  key: string;
  name: string;
  description: string | null;
  category: string | null;
  icon: string | null;
  sortOrder: number;
  controllable: boolean;
}

export interface TenantModuleEntry extends ModuleCatalogEntry {
  enabled: boolean;
}
