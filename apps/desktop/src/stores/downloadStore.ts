import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import {
  Download,
  DownloadCategory,
  DownloadProgressPayload,
  AddDownloadRequest,
  UrlProbeResult,
  DownloadChunk,
} from '../types';

interface DownloadState {
  downloads: Download[];
  selectedId: string | null;
  activeCategory: DownloadCategory;
  activeStatus: string;
  searchQuery: string;
  speedHistory: { time: string; speed: number }[];
  chunks: DownloadChunk[];
  isLoading: boolean;
  error: string | null;

  // Actions
  fetchDownloads: () => Promise<void>;
  probeUrl: (url: string) => Promise<UrlProbeResult>;
  addDownload: (req: AddDownloadRequest) => Promise<Download>;
  pauseDownload: (id: string) => Promise<void>;
  resumeDownload: (id: string) => Promise<void>;
  cancelDownload: (id: string, deleteFiles?: boolean) => Promise<void>;
  deleteDownload: (id: string, deleteFiles?: boolean) => Promise<void>;
  pauseAll: () => Promise<void>;
  resumeAll: () => Promise<void>;
  fetchChunks: (downloadId: string) => Promise<void>;
  setSelectedId: (id: string | null) => void;
  setActiveCategory: (cat: DownloadCategory) => void;
  setActiveStatus: (status: string) => void;
  setSearchQuery: (query: string) => void;
  initEventListeners: () => () => void;
}

export const useDownloadStore = create<DownloadState>((set, get) => ({
  downloads: [],
  selectedId: null,
  activeCategory: 'All',
  activeStatus: 'all',
  searchQuery: '',
  speedHistory: Array.from({ length: 60 }, (_, i) => ({ time: `${60 - i}s`, speed: 0 })),
  chunks: [],
  isLoading: false,
  error: null,

  fetchDownloads: async () => {
    try {
      set({ isLoading: true, error: null });
      const downloads = await invoke<Download[]>('list_downloads');
      set({ downloads, isLoading: false });
    } catch (e: any) {
      set({ error: e?.toString() || 'Failed to fetch downloads', isLoading: false });
    }
  },

  probeUrl: async (url: string) => {
    return await invoke<UrlProbeResult>('probe_url', { url });
  },

  addDownload: async (req: AddDownloadRequest) => {
    const download = await invoke<Download>('create_download', { request: req });
    set((state) => ({
      downloads: [download, ...state.downloads.filter((d) => d.id !== download.id)],
      selectedId: download.id,
    }));
    return download;
  },

  pauseDownload: async (id: string) => {
    await invoke('pause_download', { downloadId: id });
    set((state) => ({
      downloads: state.downloads.map((d) =>
        d.id === id ? { ...d, status: 'paused', speed: 0, eta: null } : d
      ),
    }));
  },

  resumeDownload: async (id: string) => {
    await invoke('resume_download', { downloadId: id });
    set((state) => ({
      downloads: state.downloads.map((d) =>
        d.id === id ? { ...d, status: 'downloading' } : d
      ),
    }));
  },

  cancelDownload: async (id: string, deleteFiles = false) => {
    await invoke('cancel_download', { downloadId: id, deleteFiles });
    set((state) => ({
      downloads: state.downloads.map((d) =>
        d.id === id ? { ...d, status: 'cancelled', speed: 0, eta: null } : d
      ),
    }));
  },

  deleteDownload: async (id: string, deleteFiles = false) => {
    await invoke('delete_download', { downloadId: id, deleteFiles });
    set((state) => ({
      downloads: state.downloads.filter((d) => d.id !== id),
      selectedId: state.selectedId === id ? null : state.selectedId,
    }));
  },

  pauseAll: async () => {
    await invoke('pause_all_downloads');
    set((state) => ({
      downloads: state.downloads.map((d) =>
        d.status === 'downloading' ? { ...d, status: 'paused', speed: 0, eta: null } : d
      ),
    }));
  },

  resumeAll: async () => {
    await invoke('resume_all_downloads');
    set((state) => ({
      downloads: state.downloads.map((d) =>
        d.status === 'paused' || d.status === 'queued' ? { ...d, status: 'downloading' } : d
      ),
    }));
  },

  fetchChunks: async (downloadId: string) => {
    try {
      const chunks = await invoke<DownloadChunk[]>('get_download_chunks', { downloadId });
      set({ chunks });
    } catch {
      set({ chunks: [] });
    }
  },

  setSelectedId: (id: string | null) => {
    set({ selectedId: id });
    if (id) {
      get().fetchChunks(id);
    }
  },

  setActiveCategory: (cat: DownloadCategory) => set({ activeCategory: cat }),
  setActiveStatus: (status: string) => set({ activeStatus: status }),
  setSearchQuery: (query: string) => set({ searchQuery: query }),

  initEventListeners: () => {
    let unlistenProgress: (() => void) | null = null;
    let unlistenStatus: (() => void) | null = null;
    let unlistenCreated: (() => void) | null = null;

    listen<DownloadProgressPayload>('download:progress', (event) => {
      const payload = event.payload;
      const nowStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

      set((state) => {
        const updatedDownloads = state.downloads.map((d) => {
          if (d.id === payload.download_id) {
            return {
              ...d,
              downloaded_size: payload.downloaded_size,
              file_size: payload.file_size ?? d.file_size,
              percentage: payload.percentage,
              speed: payload.speed,
              average_speed: payload.average_speed,
              eta: payload.eta,
              active_connections: payload.active_connections,
              status: payload.status,
            };
          }
          return d;
        });

        // Update speed history graph if selected download is downloading
        let newHistory = state.speedHistory;
        if (state.selectedId === payload.download_id) {
          newHistory = [...state.speedHistory.slice(1), { time: nowStr, speed: payload.speed }];
        }

        return {
          downloads: updatedDownloads,
          speedHistory: newHistory,
        };
      });
    }).then((unlisten) => {
      unlistenProgress = unlisten;
    });

    listen<Download>('download:created', (event) => {
      const newDl = event.payload;
      if (!newDl || !newDl.id) return;
      set((state) => ({
        downloads: [newDl, ...state.downloads.filter((d) => d.id !== newDl.id)],
      }));
    }).then((unlisten) => {
      unlistenCreated = unlisten;
    });

    listen<{ download_id: string; status: string; error?: string }>(
      'download:status_changed',
      async (event) => {
        const { download_id, status, error } = event.payload;
        set((state) => ({
          downloads: state.downloads.map((d) => {
            if (d.id === download_id) {
              return {
                ...d,
                status: status as any,
                error_message: error || null,
                speed: status === 'completed' || status === 'paused' || status === 'failed' ? 0 : d.speed,
                eta: status === 'completed' ? 0 : d.eta,
                percentage: status === 'completed' ? 100 : d.percentage,
              };
            }
            return d;
          }),
        }));

        if (status === 'completed') {
          // Fetch updated download to get exact file size and final file path
          try {
            const updated = await invoke<Download | null>('get_download', { downloadId: download_id });
            if (updated) {
              set((state) => ({
                downloads: state.downloads.map((d) => (d.id === download_id ? { ...updated, percentage: 100 } : d)),
              }));
              // Trigger Complete Modal
              const { useUIStore } = await import('./uiStore');
              useUIStore.getState().openCompleteModal({ ...updated, percentage: 100 });
            }
          } catch (e) {
            console.error('Failed to fetch completed download info:', e);
          }
        }
      }
    ).then((unlisten) => {
      unlistenStatus = unlisten;
    });

    return () => {
      if (unlistenProgress) unlistenProgress();
      if (unlistenStatus) unlistenStatus();
      if (unlistenCreated) unlistenCreated();
    };
  },
}));
