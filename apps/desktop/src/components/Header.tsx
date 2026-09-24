import React from 'react';
import { Plus, Play, Pause, Search, Settings, Gauge, DownloadCloud, LayoutList, LayoutGrid } from 'lucide-react';
import { useDownloadStore } from '../stores/downloadStore';
import { useUIStore } from '../stores/uiStore';
import { useSettingsStore } from '../stores/settingsStore';

export const Header: React.FC = () => {
  const { pauseAll, resumeAll, searchQuery, setSearchQuery } = useDownloadStore();
  const { openAddDialog, openSettings, viewMode, setViewMode } = useUIStore();
  const { settings, updateSettings } = useSettingsStore();

  const handleSpeedLimitChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = parseInt(e.target.value, 10);
    updateSettings({ global_speed_limit: val });
  };

  return (
    <header className="h-14 border-b border-border/70 bg-card/60 backdrop-blur-md flex items-center justify-between px-4 z-20 flex-shrink-0 select-none">
      {/* Brand & Logo */}
      <div className="flex items-center gap-3">
        <img
          src="/logonova.png"
          alt="NovaDownload"
          className="w-8 h-8 rounded-lg object-contain shadow-md shadow-primary/25 border border-primary/20"
        />
        <div>
          <span className="font-bold text-base tracking-tight bg-gradient-to-r from-foreground to-muted-foreground bg-clip-text text-transparent">
            NovaDownload
          </span>
          <span className="ml-2 text-[10px] uppercase font-semibold px-1.5 py-0.5 rounded bg-primary/15 text-primary border border-primary/20">
            Pro
          </span>
        </div>
      </div>

      {/* Main Actions Bar */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => openAddDialog()}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-semibold shadow-sm shadow-primary/30 transition active:scale-95 cursor-pointer"
          title="Add Download (Ctrl+N)"
        >
          <Plus className="w-4 h-4" />
          <span>Add Download</span>
        </button>

        <div className="h-5 w-[1px] bg-border mx-1" />

        <button
          onClick={() => resumeAll()}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-secondary hover:bg-secondary/80 text-foreground text-xs font-medium transition cursor-pointer"
          title="Resume All (Ctrl+R)"
        >
          <Play className="w-3.5 h-3.5 text-emerald-500 fill-emerald-500" />
          <span>Resume All</span>
        </button>

        <button
          onClick={() => pauseAll()}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-secondary hover:bg-secondary/80 text-foreground text-xs font-medium transition cursor-pointer"
          title="Pause All (Ctrl+P)"
        >
          <Pause className="w-3.5 h-3.5 text-amber-500 fill-amber-500" />
          <span>Pause All</span>
        </button>

        {/* Speed Limiter Quick Menu */}
        <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-secondary/80 border border-border/50 text-xs font-medium">
          <Gauge className="w-3.5 h-3.5 text-muted-foreground" />
          <select
            value={settings?.global_speed_limit || 0}
            onChange={handleSpeedLimitChange}
            className="bg-transparent text-xs text-foreground outline-none cursor-pointer pr-1"
          >
            <option value={0} className="bg-card text-foreground">Unlimited</option>
            <option value={1048576} className="bg-card text-foreground">1 MB/s</option>
            <option value={5242880} className="bg-card text-foreground">5 MB/s</option>
            <option value={10485760} className="bg-card text-foreground">10 MB/s</option>
            <option value={20971520} className="bg-card text-foreground">20 MB/s</option>
          </select>
        </div>
      </div>

      {/* View Switcher, Search & Settings */}
      <div className="flex items-center gap-2">
        {/* View Mode Toggle */}
        <div className="flex items-center bg-secondary/80 p-0.5 rounded-lg border border-border/60">
          <button
            onClick={() => setViewMode('list')}
            className={`p-1.5 rounded-md transition cursor-pointer ${
              viewMode === 'list'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
            title="List View (Table)"
          >
            <LayoutList className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setViewMode('grid')}
            className={`p-1.5 rounded-md transition cursor-pointer ${
              viewMode === 'grid'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
            title="Grid View (Cards & Thumbnails)"
          >
            <LayoutGrid className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search downloads..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-44 pl-8 pr-3 py-1.5 rounded-md bg-secondary/70 hover:bg-secondary border border-border/50 focus:border-primary focus:bg-background text-xs outline-none transition"
          />
        </div>

        <button
          onClick={() => openSettings()}
          className="p-1.5 rounded-md hover:bg-secondary text-muted-foreground hover:text-foreground transition cursor-pointer"
          title="Settings (Ctrl+,)"
        >
          <Settings className="w-4 h-4" />
        </button>
      </div>
    </header>
  );
};
