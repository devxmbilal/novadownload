import { create } from 'zustand';
import { Download } from '../types';

export interface PrefilledMediaOptions {
  formatId?: string;
  isAudioOnly?: boolean;
  fileSize?: number;
  title?: string;
}

export interface AddDialogSession {
  id: string;
  url: string;
  mediaOptions?: PrefilledMediaOptions | null;
  createdAt: number;
}

interface UIState {
  currentView: 'downloads' | 'dashboard' | 'scheduled';
  addDialogSessions: AddDialogSession[];
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
  closeAddDialog: (id?: string) => void;
  bringDialogToFront: (id: string) => void;
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
  addDialogSessions: [],
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
    set((state) => {
      // If user opened an empty dialog (no URL), and an empty dialog is already open, just bring it to front
      if (!url) {
        const existingEmpty = state.addDialogSessions.find((s) => !s.url);
        if (existingEmpty) {
          return {
            addDialogSessions: [
              ...state.addDialogSessions.filter((s) => s.id !== existingEmpty.id),
              existingEmpty,
            ],
            isAddDialogOpen: true,
          };
        }
      }

      // If exact same URL is already open within the last 3 seconds, just bring it to front
      const existingSameUrl = state.addDialogSessions.find(
        (s) => s.url && s.url === url && Date.now() - s.createdAt < 3000
      );
      if (existingSameUrl) {
        return {
          addDialogSessions: [
            ...state.addDialogSessions.filter((s) => s.id !== existingSameUrl.id),
            existingSameUrl,
          ],
          isAddDialogOpen: true,
        };
      }

      const newSession: AddDialogSession = {
        id: 'dlg_' + Math.random().toString(36).substring(2, 9) + '_' + Date.now(),
        url,
        mediaOptions: mediaOptions || null,
        createdAt: Date.now(),
      };

      const updated = [...state.addDialogSessions, newSession];
      return {
        addDialogSessions: updated,
        isAddDialogOpen: true,
        prefilledUrl: url,
        prefilledMediaOptions: mediaOptions || null,
      };
    }),

  closeAddDialog: (id?: string) =>
    set((state) => {
      if (!id) {
        return {
          addDialogSessions: [],
          isAddDialogOpen: false,
          prefilledUrl: '',
          prefilledMediaOptions: null,
        };
      }
      const updated = state.addDialogSessions.filter((s) => s.id !== id);
      const lastSession = updated.length > 0 ? updated[updated.length - 1] : null;
      return {
        addDialogSessions: updated,
        isAddDialogOpen: updated.length > 0,
        prefilledUrl: lastSession ? lastSession.url : '',
        prefilledMediaOptions: lastSession ? lastSession.mediaOptions || null : null,
      };
    }),

  bringDialogToFront: (id: string) =>
    set((state) => {
      const target = state.addDialogSessions.find((s) => s.id === id);
      if (!target) return state;
      return {
        addDialogSessions: [
          ...state.addDialogSessions.filter((s) => s.id !== id),
          target,
        ],
      };
    }),
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

