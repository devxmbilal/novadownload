import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { AppSettings, FFmpegInfo } from '../types';

interface SettingsState {
  settings: AppSettings | null;
  ffmpegInfo: FFmpegInfo | null;
  isLoading: boolean;
  error: string | null;

  fetchSettings: () => Promise<void>;
  updateSettings: (newSettings: Partial<AppSettings>) => Promise<void>;
  detectFFmpeg: () => Promise<void>;
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: null,
  ffmpegInfo: null,
  isLoading: false,
  error: null,

  fetchSettings: async () => {
    try {
      set({ isLoading: true });
      const settings = await invoke<AppSettings>('get_settings');
      set({ settings, isLoading: false });
    } catch (e: any) {
      set({ error: e?.toString() || 'Failed to load settings', isLoading: false });
    }
  },

  updateSettings: async (newSettings: Partial<AppSettings>) => {
    const current = get().settings;
    if (!current) return;
    try {
      const merged = { ...current, ...newSettings };
      const updated = await invoke<AppSettings>('update_settings', { settings: merged });
      set({ settings: updated });
    } catch (e: any) {
      set({ error: e?.toString() || 'Failed to update settings' });
    }
  },

  detectFFmpeg: async () => {
    try {
      const info = await invoke<FFmpegInfo>('detect_ffmpeg');
      set({ ffmpegInfo: info });
    } catch {
      set({
        ffmpegInfo: { is_available: false, version: null, binary_path: null },
      });
    }
  },
}));
