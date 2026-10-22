import { create } from 'zustand';
import type { AuthSession, AuthUser, Membership, Role } from '@/types/auth';

export type AuthStatus = 'idle' | 'loading' | 'authenticated' | 'unauthenticated' | 'unavailable';

interface AuthState {
  session: AuthSession | null;
  status: AuthStatus;
  memberships: Membership[];
  platformAdmin: boolean;
  setSession: (session: AuthSession) => void;
  setStatus: (status: AuthStatus) => void;
  setMemberships: (memberships: Membership[]) => void;
  setPlatformAdmin: (value: boolean) => void;
  updateUser: (user: Partial<AuthUser>) => void;
  updateTenantName: (name: string) => void;
  clearSession: () => void;
  hasRole: (...roles: Role[]) => boolean;
}

export const useAuthStore = create<AuthState>()((set, get) => ({
  session: null,
  status: 'idle',
  memberships: [],
  platformAdmin: false,
  setSession: (session) => set({ session, status: 'authenticated' }),
  setStatus: (status) => set({ status }),
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
  clearSession: () =>
    set({ session: null, status: 'unauthenticated', memberships: [], platformAdmin: false }),
  hasRole: (...roles) => {
    const role = get().session?.role;
    return role ? roles.includes(role) : false;
  },
}));
