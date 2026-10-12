import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { AuthSession, AuthUser, Membership, Role } from '@/types/auth';

interface AuthState {
  session: AuthSession | null;
  memberships: Membership[];
  platformAdmin: boolean;
  setSession: (session: AuthSession) => void;
  setMemberships: (memberships: Membership[]) => void;
  setPlatformAdmin: (value: boolean) => void;
  updateUser: (user: Partial<AuthUser>) => void;
  updateTenantName: (name: string) => void;
  clearSession: () => void;
  hasRole: (...roles: Role[]) => boolean;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      session: null,
      memberships: [],
      platformAdmin: false,
      setSession: (session) => set({ session }),
      setMemberships: (memberships) => set({ memberships }),
      setPlatformAdmin: (value) => set({ platformAdmin: value }),
      updateUser: (user) =>
        set((state) => ({
          session: state.session ? { ...state.session, user: { ...state.session.user, ...user } } : null,
        })),
      updateTenantName: (name) =>
        set((state) => ({
          session: state.session
            ? { ...state.session, tenant: { ...state.session.tenant, name } }
            : null,
          memberships: state.memberships.map((membership) =>
            membership.tenantId === state.session?.tenant.id
              ? { ...membership, tenantName: name }
              : membership,
          ),
        })),
      clearSession: () => set({ session: null, memberships: [], platformAdmin: false }),
      hasRole: (...roles) => {
        const role = get().session?.role;
        return role ? roles.includes(role) : false;
      },
    }),
    {
      name: 'orderup-auth',
      storage: createJSONStorage(() => sessionStorage),
    },
  ),
);
