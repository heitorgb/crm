import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type SidebarPosition = 'left' | 'right';

interface UiState {
  sidebarCollapsed: boolean;
  mobileSidebarOpen: boolean;
  sidebarPosition: SidebarPosition;
  expandedNavGroups: Record<string, boolean>;
  toggleSidebar: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setMobileSidebarOpen: (open: boolean) => void;
  setSidebarPosition: (position: SidebarPosition) => void;
  setNavGroupExpanded: (groupId: string, expanded: boolean) => void;
}

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      sidebarCollapsed: false,
      mobileSidebarOpen: false,
      sidebarPosition: 'left',
      expandedNavGroups: {},
      toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
      setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
      setMobileSidebarOpen: (mobileSidebarOpen) => set({ mobileSidebarOpen }),
      setSidebarPosition: (sidebarPosition) => set({ sidebarPosition }),
      setNavGroupExpanded: (groupId, expanded) =>
        set((state) => ({
          expandedNavGroups: { ...state.expandedNavGroups, [groupId]: expanded },
        })),
    }),
    {
      name: 'orderup-ui',
      partialize: (state) => ({
        sidebarCollapsed: state.sidebarCollapsed,
        sidebarPosition: state.sidebarPosition,
        expandedNavGroups: state.expandedNavGroups,
      }),
    },
  ),
);
