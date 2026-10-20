import { create } from 'zustand';
import type { ConversationStatus } from '@/types/attendance';

interface AttendanceViewState {
  search: string;
  status: ConversationStatus | 'ALL';
  instanceId: string;
  archivedView: boolean;
  photoComposerOpen: boolean;
  setSearch: (search: string) => void;
  setStatus: (status: ConversationStatus | 'ALL') => void;
  setInstanceId: (instanceId: string) => void;
  setArchivedView: (archivedView: boolean) => void;
  resetFilters: () => void;
  openPhotoComposer: () => void;
  closePhotoComposer: () => void;
}

export const useAttendanceViewStore = create<AttendanceViewState>()((set) => ({
  search: '',
  status: 'ALL',
  instanceId: 'ALL',
  archivedView: false,
  photoComposerOpen: false,
  setSearch: (search) => set({ search }),
  setStatus: (status) => set({ status }),
  setInstanceId: (instanceId) => set({ instanceId }),
  setArchivedView: (archivedView) => set({ archivedView }),
  resetFilters: () => set({ status: 'ALL', instanceId: 'ALL', archivedView: false }),
  openPhotoComposer: () => set({ photoComposerOpen: true }),
  closePhotoComposer: () => set({ photoComposerOpen: false }),
}));
