import { create } from 'zustand';
import { Download } from '../types';

export interface PrefilledMediaOptions {
  formatId?: string;
  isAudioOnly?: boolean;
  fileSize?: number;
  title?: string;
}

interface UIState {
  currentView: 'downloads' | 'dashboard' | 'scheduled';
  isAddDialogOpen: boolean;
  prefilledUrl: string;
  prefilledMediaOptions: PrefilledMediaOptions | null;
  viewMode: 'list' | 'grid';
  isSettingsOpen: boolean;
  isDetailsOpen: boolean;
  completedDownload: Download | null;
  contextMenu: {
    isOpen: boolean;
    x: number;
    y: number;
    downloadId: string | null;
  };

  setCurrentView: (view: 'downloads' | 'dashboard' | 'scheduled') => void;
  setViewMode: (mode: 'list' | 'grid') => void;
  openAddDialog: (url?: string, mediaOptions?: PrefilledMediaOptions) => void;
  closeAddDialog: () => void;
  openSettings: () => void;
  closeSettings: () => void;
  toggleDetails: () => void;
  openCompleteModal: (download: Download) => void;
  closeCompleteModal: () => void;
  openContextMenu: (x: number, y: number, downloadId: string) => void;
  closeContextMenu: () => void;
}

export const useUIStore = create<UIState>((set) => ({
  currentView: 'downloads',
  isAddDialogOpen: false,
  prefilledUrl: '',
  prefilledMediaOptions: null,
  viewMode: 'list',
  isSettingsOpen: false,
  isDetailsOpen: true,
  completedDownload: null,
  contextMenu: {
    isOpen: false,
    x: 0,
    y: 0,
    downloadId: null,
  },

  setCurrentView: (view) => set({ currentView: view }),
  setViewMode: (mode) => set({ viewMode: mode }),
  openAddDialog: (url = '', mediaOptions) =>
    set({ isAddDialogOpen: true, prefilledUrl: url, prefilledMediaOptions: mediaOptions || null }),
  closeAddDialog: () => set({ isAddDialogOpen: false, prefilledUrl: '', prefilledMediaOptions: null }),
  openSettings: () => set({ isSettingsOpen: true }),
  closeSettings: () => set({ isSettingsOpen: false }),
  toggleDetails: () => set((state) => ({ isDetailsOpen: !state.isDetailsOpen })),
  openCompleteModal: (download) => set({ completedDownload: download }),
  closeCompleteModal: () => set({ completedDownload: null }),
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

