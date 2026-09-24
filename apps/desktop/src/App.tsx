import React, { useEffect } from 'react';
import { Header } from './components/Header';
import { Sidebar } from './components/Sidebar';
import { DownloadTable } from './components/DownloadTable';
import { DownloadGridView } from './components/DownloadGridView';
import { DownloadDetailPanel } from './components/DownloadDetailPanel';
import { AddDownloadDialog } from './components/AddDownloadDialog';
import { SettingsDialog } from './components/SettingsDialog';
import { DownloadCompleteModal } from './components/DownloadCompleteModal';
import { ContextMenu } from './components/ContextMenu';
import { DashboardView } from './components/DashboardView';
import { useDownloadStore } from './stores/downloadStore';
import { useSettingsStore } from './stores/settingsStore';
import { useUIStore } from './stores/uiStore';
import { listen } from '@tauri-apps/api/event';
import { readText } from '@tauri-apps/plugin-clipboard-manager';

export function App() {
  const {
    fetchDownloads,
    initEventListeners,
    selectedId,
    pauseDownload,
    resumeDownload,
    deleteDownload,
  } = useDownloadStore();

  const { fetchSettings, detectFFmpeg } = useSettingsStore();
  const { currentView, openAddDialog, openSettings, viewMode } = useUIStore();

  useEffect(() => {
    // Initial fetch
    fetchDownloads();
    fetchSettings();
    detectFFmpeg();

    // Event listeners
    const cleanupEvents = initEventListeners();

    // Browser handoff event listener
    let unlistenBrowser: (() => void) | null = null;
    listen<any>('browser:download_received', (event) => {
      const payload = event.payload;
      if (payload?.url) {
        openAddDialog(payload.url, {
          formatId: payload.format_id,
          isAudioOnly: payload.is_audio_only,
          fileSize: payload.file_size,
          title: payload.title || payload.file_name,
        });
      }
    }).then((unlisten) => {
      unlistenBrowser = unlisten;
    });

    // Keyboard Shortcuts
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        openAddDialog();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'p') {
        if (selectedId) {
          e.preventDefault();
          pauseDownload(selectedId);
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'r') {
        if (selectedId) {
          e.preventDefault();
          resumeDownload(selectedId);
        }
      } else if (e.key === 'Delete') {
        if (selectedId) {
          e.preventDefault();
          deleteDownload(selectedId, false);
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key === ',') {
        e.preventDefault();
        openSettings();
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    // Periodic poll to ensure consistency
    const interval = setInterval(fetchDownloads, 4000);

    return () => {
      cleanupEvents();
      if (unlistenBrowser) unlistenBrowser();
      window.removeEventListener('keydown', handleKeyDown);
      clearInterval(interval);
    };
  }, []);

  // Handle Drag & Drop of URL strings
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const text = e.dataTransfer.getData('text/plain');
    if (text && (text.startsWith('http://') || text.startsWith('https://'))) {
      openAddDialog(text);
    }
  };

  return (
    <div
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      className="flex flex-col h-screen w-screen bg-background text-foreground overflow-hidden"
    >
      <Header />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        {currentView === 'dashboard' ? (
          <DashboardView />
        ) : (
          <main className="flex flex-1 overflow-hidden">
            {viewMode === 'grid' ? <DownloadGridView /> : <DownloadTable />}
            <DownloadDetailPanel />
          </main>
        )}
      </div>

      {/* Bottom Status Bar / Footer */}
      <footer className="h-6 px-4 bg-card/90 border-t border-border/60 flex items-center justify-between text-[11px] text-muted-foreground select-none z-20">
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
            <span>Ready</span>
          </span>
          <span>•</span>
          <span>NovaDownload Turbo Engine</span>
        </div>
        <div className="flex items-center gap-1 font-medium text-foreground/80 hover:text-foreground transition cursor-default">
          <span>Made with</span>
          <span className="text-rose-500 animate-pulse">❤️</span>
          <span>in Pakistan</span>
          <span className="text-sm ml-0.5">🇵🇰</span>
        </div>
      </footer>

      {/* Modals & Menus */}
      <AddDownloadDialog />
      <SettingsDialog />
      <DownloadCompleteModal />
      <ContextMenu />
    </div>
  );
}

export default App;
