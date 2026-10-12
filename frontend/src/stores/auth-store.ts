import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { AuthSession, Membership, Role } from '@/types/auth';

interface AuthState {
  session: AuthSession | null;
  memberships: Membership[];
  platformAdmin: boolean;
  setSession: (session: AuthSession) => void;
  setMemberships: (memberships: Membership[]) => void;
  setPlatformAdmin: (value: boolean) => void;
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
