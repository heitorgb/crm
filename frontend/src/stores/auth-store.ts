import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { AuthSession, Membership, Role } from '@/types/auth';

interface AuthState {
  session: AuthSession | null;
  memberships: Membership[];
  setSession: (session: AuthSession) => void;
  setMemberships: (memberships: Membership[]) => void;
  clearSession: () => void;
  hasRole: (...roles: Role[]) => boolean;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      session: null,
      memberships: [],
      setSession: (session) => set({ session }),
      setMemberships: (memberships) => set({ memberships }),
      clearSession: () => set({ session: null, memberships: [] }),
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
