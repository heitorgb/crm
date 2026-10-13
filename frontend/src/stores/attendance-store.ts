import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface AttendanceState {
  showAgentName: boolean;
  setShowAgentName: (enabled: boolean) => void;
}

export const useAttendanceStore = create<AttendanceState>()(
  persist(
    (set) => ({
      showAgentName: true,
      setShowAgentName: (showAgentName) => set({ showAgentName }),
    }),
    { name: 'orderup-attendance' },
  ),
);
