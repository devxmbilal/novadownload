import { create } from 'zustand';

interface UIState {
  currentView: 'downloads' | 'dashboard' | 'scheduled';
  isAddDialogOpen: boolean;
  prefilledUrl: string;
  viewMode: 'list' | 'grid';
  isSettingsOpen: boolean;
  isDetailsOpen: boolean;
  contextMenu: {
    isOpen: boolean;
    x: number;
    y: number;
    downloadId: string | null;
  };

  setCurrentView: (view: 'downloads' | 'dashboard' | 'scheduled') => void;
  setViewMode: (mode: 'list' | 'grid') => void;
  openAddDialog: (url?: string) => void;
  closeAddDialog: () => void;
  openSettings: () => void;
  closeSettings: () => void;
  toggleDetails: () => void;
  openContextMenu: (x: number, y: number, downloadId: string) => void;
  closeContextMenu: () => void;
}

export const useUIStore = create<UIState>((set) => ({
  currentView: 'downloads',
  isAddDialogOpen: false,
  prefilledUrl: '',
  viewMode: 'list',
  isSettingsOpen: false,
  isDetailsOpen: true,
  contextMenu: {
    isOpen: false,
    x: 0,
    y: 0,
    downloadId: null,
  },

  setCurrentView: (view) => set({ currentView: view }),
  setViewMode: (mode) => set({ viewMode: mode }),
  openAddDialog: (url = '') => set({ isAddDialogOpen: true, prefilledUrl: url }),
  closeAddDialog: () => set({ isAddDialogOpen: false, prefilledUrl: '' }),
  openSettings: () => set({ isSettingsOpen: true }),
  closeSettings: () => set({ isSettingsOpen: false }),
  toggleDetails: () => set((state) => ({ isDetailsOpen: !state.isDetailsOpen })),
  openContextMenu: (x, y, downloadId) =>
    set({
      contextMenu: {
        isOpen: true,
        x,
        y,
        downloadId,
      },
    }),
  closeContextMenu: () =>
    set({
      contextMenu: {
        isOpen: false,
        x: 0,
        y: 0,
        downloadId: null,
      },
    }),
}));
