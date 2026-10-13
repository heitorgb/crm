import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface NotificationState {
  tabBadgeEnabled: boolean;
  soundEnabled: boolean;
  unreadCounts: Record<string, number>;
  setTabBadgeEnabled: (enabled: boolean) => void;
  setSoundEnabled: (enabled: boolean) => void;
  markUnread: (conversationId: string) => void;
  markRead: (conversationId: string) => void;
  markAllRead: () => void;
}

export const useNotificationStore = create<NotificationState>()(
  persist(
    (set) => ({
      tabBadgeEnabled: true,
      soundEnabled: true,
      unreadCounts: {},
      setTabBadgeEnabled: (tabBadgeEnabled) => set({ tabBadgeEnabled }),
      setSoundEnabled: (soundEnabled) => set({ soundEnabled }),
      markUnread: (conversationId) =>
        set((state) => ({
          unreadCounts: {
            ...state.unreadCounts,
            [conversationId]: (state.unreadCounts[conversationId] ?? 0) + 1,
          },
        })),
      markRead: (conversationId) =>
        set((state) => {
          if (!(conversationId in state.unreadCounts)) {
            return state;
          }
          const { [conversationId]: _read, ...unreadCounts } = state.unreadCounts;
          return { unreadCounts };
        }),
      markAllRead: () => set({ unreadCounts: {} }),
    }),
    { name: 'orderup-notifications' },
  ),
);
