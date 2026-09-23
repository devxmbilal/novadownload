import React, { useEffect } from 'react';
import { Header } from './components/Header';
import { Sidebar } from './components/Sidebar';
import { DownloadTable } from './components/DownloadTable';
import { DownloadDetailPanel } from './components/DownloadDetailPanel';
import { AddDownloadDialog } from './components/AddDownloadDialog';
import { SettingsDialog } from './components/SettingsDialog';
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
  const { currentView, openAddDialog, openSettings } = useUIStore();

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
        openAddDialog(payload.url);
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
            <DownloadTable />
            <DownloadDetailPanel />
          </main>
        )}
      </div>

      {/* Modals & Menus */}
      <AddDownloadDialog />
      <SettingsDialog />
      <ContextMenu />
    </div>
  );
}

export default App;
