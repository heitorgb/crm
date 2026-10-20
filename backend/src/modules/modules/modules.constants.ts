export const MODULE_KEYS = {
  ATTENDANCE: 'attendance',
  CONTACTS: 'contacts',
  LEADS: 'leads',
  BILLING_CHARGES: 'billing.charges',
  BILLING_COLLECTION: 'billing.collection',
  WEBHOOKS: 'webhooks',
} as const;

export type ModuleKey = (typeof MODULE_KEYS)[keyof typeof MODULE_KEYS];

export const REQUIRED_MODULE_KEY = 'requiredModuleKey';
