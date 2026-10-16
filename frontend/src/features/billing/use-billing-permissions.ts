import { useAuthStore } from '@/stores/auth-store';

/**
 * Billing management (charge edits, manual settlement, settings and recurrence
 * changes) mirrors the backend rule: only OWNER/ADMIN memberships may write.
 * Reads are available to every authenticated member. This is a UI mirror of the
 * server-side `@Roles('OWNER', 'ADMIN')` guard, which remains the source of truth.
 */
export function useBillingPermissions(): { canManage: boolean } {
  const role = useAuthStore((state) => state.session?.role);
  return { canManage: role === 'OWNER' || role === 'ADMIN' };
}
