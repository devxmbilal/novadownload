import React, { useEffect, useState } from 'react';
import {
  Layers,
  ArrowDownCircle,
  CheckCircle2,
  AlertTriangle,
  Zap,
  HardDrive,
  Clock,
  Plus,
  ArrowUpRight,
} from 'lucide-react';
import { useDownloadStore } from '../stores/downloadStore';
import { useUIStore } from '../stores/uiStore';
import { formatBytes, formatSpeed } from '../lib/utils';
import { invoke } from '@tauri-apps/api/core';
import { SystemStats } from '../types';

export const DashboardView: React.FC = () => {
  const { downloads, speedHistory } = useDownloadStore();
  const { openAddDialog, setCurrentView } = useUIStore();
  const [stats, setStats] = useState<SystemStats | null>(null);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const res = await invoke<SystemStats>('get_system_stats');
        setStats(res);
      } catch {}
    };

    fetchStats();
    const interval = setInterval(fetchStats, 2000);
    return () => clearInterval(interval);
  }, []);

  const activeDownloads = downloads.filter((d) => d.status === 'downloading');
  const recentDownloads = downloads.slice(0, 5);
  const maxSpeed = Math.max(...speedHistory.map((s) => s.speed), 1024 * 100);

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-6 select-none bg-background">
      {/* Top Banner */}
      <div className="p-6 rounded-2xl bg-gradient-to-r from-primary/20 via-nova-900/20 to-card border border-primary/20 flex items-center justify-between shadow-lg">
        <div className="space-y-1">
          <h2 className="text-xl font-bold text-foreground">Welcome to NovaDownload</h2>
          <p className="text-xs text-muted-foreground">
            High-speed multi-connection download accelerator with intelligent scheduling.
          </p>
        </div>
        <button
          onClick={() => openAddDialog()}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-semibold shadow-md shadow-primary/30 transition active:scale-95 cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          <span>New Download</span>
        </button>
      </div>

      {/* Metrics Cards */}
      <div className="grid grid-cols-4 gap-4">
        <div className="p-4 rounded-xl bg-card border border-border shadow-sm space-y-2">
          <div className="flex items-center justify-between text-muted-foreground text-xs">
            <span>Active Downloads</span>
            <ArrowDownCircle className="w-4 h-4 text-primary" />
          </div>
          <div className="text-2xl font-bold font-mono text-foreground">
            {stats?.active_downloads ?? 0}
          </div>
          <div className="text-[11px] text-muted-foreground font-mono">
            {stats?.total_downloads ?? 0} total in history
          </div>
        </div>

        <div className="p-4 rounded-xl bg-card border border-border shadow-sm space-y-2">
          <div className="flex items-center justify-between text-muted-foreground text-xs">
            <span>Bandwidth Speed</span>
            <Zap className="w-4 h-4 text-amber-500" />
          </div>
          <div className="text-2xl font-bold font-mono text-primary">
            {formatSpeed(stats?.current_download_speed ?? 0)}
          </div>
          <div className="text-[11px] text-muted-foreground font-mono">
            Live network throughput
          </div>
        </div>

        <div className="p-4 rounded-xl bg-card border border-border shadow-sm space-y-2">
          <div className="flex items-center justify-between text-muted-foreground text-xs">
            <span>Completed</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-500" />
          </div>
          <div className="text-2xl font-bold font-mono text-emerald-500">
            {stats?.completed_downloads ?? 0}
          </div>
          <div className="text-[11px] text-muted-foreground font-mono">
            Successfully downloaded
          </div>
        </div>

        <div className="p-4 rounded-xl bg-card border border-border shadow-sm space-y-2">
          <div className="flex items-center justify-between text-muted-foreground text-xs">
            <span>Total Transferred</span>
            <HardDrive className="w-4 h-4 text-indigo-400" />
          </div>
          <div className="text-2xl font-bold font-mono text-foreground">
            {formatBytes(stats?.total_bytes_downloaded ?? 0)}
          </div>
          <div className="text-[11px] text-muted-foreground font-mono">
            Data received
          </div>
        </div>
      </div>

      {/* Network Bandwidth Graph */}
      <div className="p-5 rounded-xl bg-card border border-border space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Zap className="w-4 h-4 text-primary" />
            <h3 className="font-semibold text-xs text-foreground">Global Bandwidth Activity</h3>
          </div>
          <span className="font-mono text-xs font-semibold text-primary">
            {formatSpeed(stats?.current_download_speed ?? 0)}
          </span>
        </div>

        <div className="h-28 w-full bg-background/50 rounded-lg p-3 border border-border/60 flex items-end gap-[3px] overflow-hidden">
          {speedHistory.map((sample, idx) => {
            const heightPercent = Math.max(4, Math.round((sample.speed / maxSpeed) * 100));
            return (
              <div
                key={idx}
                className="flex-1 bg-gradient-to-t from-primary/30 to-primary rounded-t-[1px] transition-all duration-300"
                style={{ height: `${heightPercent}%` }}
                title={`${sample.time}: ${formatSpeed(sample.speed)}`}
              />
            );
          })}
        </div>
      </div>

      {/* Recent Downloads Table */}
      <div className="p-5 rounded-xl bg-card border border-border space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-xs text-foreground">Recent Downloads</h3>
          <button
            onClick={() => setCurrentView('downloads')}
            className="flex items-center gap-1 text-xs text-primary hover:underline cursor-pointer font-medium"
          >
            <span>View All</span>
            <ArrowUpRight className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="divide-y divide-border/40 text-xs">
          {recentDownloads.length === 0 ? (
            <div className="py-6 text-center text-muted-foreground text-xs">
              No recent downloads
            </div>
          ) : (
            recentDownloads.map((dl) => (
              <div key={dl.id} className="py-2.5 flex items-center justify-between">
                <div className="space-y-0.5 truncate pr-4">
                  <div className="font-medium text-foreground truncate">{dl.file_name}</div>
                  <div className="text-[11px] text-muted-foreground font-mono">
                    {formatBytes(dl.downloaded_size)} / {formatBytes(dl.file_size)}
                  </div>
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                  <span className="text-[11px] font-semibold text-muted-foreground uppercase">
                    {dl.status}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
