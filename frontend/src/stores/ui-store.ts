import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type SidebarPosition = 'left' | 'right';

interface UiState {
  sidebarCollapsed: boolean;
  mobileSidebarOpen: boolean;
  sidebarPosition: SidebarPosition;
  toggleSidebar: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setMobileSidebarOpen: (open: boolean) => void;
  setSidebarPosition: (position: SidebarPosition) => void;
}

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      sidebarCollapsed: false,
      mobileSidebarOpen: false,
      sidebarPosition: 'left',
      toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
      setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
      setMobileSidebarOpen: (mobileSidebarOpen) => set({ mobileSidebarOpen }),
      setSidebarPosition: (sidebarPosition) => set({ sidebarPosition }),
    }),
    {
      name: 'orderup-ui',
      partialize: (state) => ({
        sidebarCollapsed: state.sidebarCollapsed,
        sidebarPosition: state.sidebarPosition,
      }),
    },
  ),
);
