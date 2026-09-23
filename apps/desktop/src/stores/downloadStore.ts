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
      const freshDownloads = await invoke<Download[]>('list_downloads');
      set((state) => {
        const merged = freshDownloads.map((fresh) => {
          const existing = state.downloads.find((d) => d.id === fresh.id);
          if (existing) {
            if (existing.status === 'downloading' || existing.status === 'processing') {
              const canonicalDownloaded = Math.max(existing.downloaded_size, fresh.downloaded_size);
              const canonicalTotal = existing.file_size || fresh.file_size;
              const canonicalPct = canonicalTotal && canonicalTotal > 0
                ? Math.min(100, Math.max(existing.percentage || 0, (canonicalDownloaded / canonicalTotal) * 100))
                : (existing.percentage || fresh.percentage || 0);

              return {
                ...fresh,
                status: existing.status,
                downloaded_size: canonicalDownloaded,
                file_size: canonicalTotal,
                percentage: canonicalPct,
                speed: existing.speed,
                average_speed: existing.average_speed || fresh.average_speed,
                eta: existing.eta,
                active_connections: existing.active_connections,
                progress_sequence: Math.max(existing.progress_sequence || 0, fresh.progress_sequence || 0),
                thumbnail: existing.thumbnail || fresh.thumbnail,
              };
            }
            if (fresh.status === 'completed') {
              const finalSize = fresh.file_size || fresh.downloaded_size || existing.file_size || existing.downloaded_size;
              return {
                ...fresh,
                downloaded_size: finalSize,
                file_size: finalSize,
                percentage: 100,
                speed: 0,
                eta: null,
                active_connections: 0,
                thumbnail: existing.thumbnail || fresh.thumbnail,
                average_speed: existing.average_speed || fresh.average_speed,
              };
            }
          }
          return fresh;
        });
        return { downloads: merged, isLoading: false };
      });
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
        let isStale = false;
        const updatedDownloads = state.downloads.map((d) => {
          if (d.id === payload.download_id) {
            // Sequence check: ignore stale/out-of-order events
            if (
              payload.progress_sequence !== undefined &&
              d.progress_sequence !== undefined &&
              payload.progress_sequence < d.progress_sequence
            ) {
              isStale = true;
              return d;
            }

            const isCompleted = payload.status === 'completed';
            const totalBytes = payload.file_size ?? d.file_size;
            const downloadedBytes = isCompleted
              ? (totalBytes ?? Math.max(d.downloaded_size, payload.downloaded_size))
              : Math.max(d.downloaded_size, payload.downloaded_size);

            const percentage = isCompleted
              ? 100
              : totalBytes && totalBytes > 0
              ? Math.min(100, Math.max(d.percentage || 0, (downloadedBytes / totalBytes) * 100))
              : payload.percentage;

            return {
              ...d,
              downloaded_size: downloadedBytes,
              file_size: totalBytes,
              percentage,
              speed: isCompleted ? 0 : payload.speed,
              average_speed: payload.average_speed,
              eta: isCompleted ? null : payload.eta,
              active_connections: isCompleted ? 0 : payload.active_connections,
              status: payload.status,
              progress_sequence: payload.progress_sequence ?? ((d.progress_sequence || 0) + 1),
            };
          }
          return d;
        });

        if (isStale) {
          return state;
        }

        // Update speed history graph if selected download is active
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
