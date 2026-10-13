import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface NotificationState {
  tabBadgeEnabled: boolean;
  soundEnabled: boolean;
  unreadConversationIds: string[];
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
      unreadConversationIds: [],
      setTabBadgeEnabled: (tabBadgeEnabled) => set({ tabBadgeEnabled }),
      setSoundEnabled: (soundEnabled) => set({ soundEnabled }),
      markUnread: (conversationId) =>
        set((state) =>
          state.unreadConversationIds.includes(conversationId)
            ? state
            : { unreadConversationIds: [...state.unreadConversationIds, conversationId] },
        ),
      markRead: (conversationId) =>
        set((state) => ({
          unreadConversationIds: state.unreadConversationIds.filter(
            (id) => id !== conversationId,
          ),
        })),
      markAllRead: () => set({ unreadConversationIds: [] }),
    }),
    { name: 'orderup-notifications' },
  ),
);
