import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface NotificationState {
  tabBadgeEnabled: boolean;
  soundEnabled: boolean;
  setTabBadgeEnabled: (enabled: boolean) => void;
  setSoundEnabled: (enabled: boolean) => void;
}

export const useNotificationStore = create<NotificationState>()(
  persist(
    (set) => ({
      tabBadgeEnabled: true,
      soundEnabled: true,
      setTabBadgeEnabled: (tabBadgeEnabled) => set({ tabBadgeEnabled }),
      setSoundEnabled: (soundEnabled) => set({ soundEnabled }),
    }),
    {
      name: 'orderup-notifications',
      version: 1,
      migrate: (persistedState) => {
        if (
          persistedState &&
          typeof persistedState === 'object' &&
          'unreadCounts' in persistedState
        ) {
          const { unreadCounts: _legacy, ...rest } = persistedState as Record<string, unknown>;
          return rest as unknown as NotificationState;
        }
        return persistedState as NotificationState;
      },
    },
  ),
);
