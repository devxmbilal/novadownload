import React, { useEffect, useState } from 'react';
import {
  X,
  ExternalLink,
  Folder,
  Layers,
  Activity,
  HardDrive,
  Clock,
  Zap,
  Globe,
  FileCode,
  CheckCircle2,
} from 'lucide-react';
import { useDownloadStore } from '../stores/downloadStore';
import { formatBytes, formatSpeed, formatEta } from '../lib/utils';
import { invoke } from '@tauri-apps/api/core';

export const DownloadDetailPanel: React.FC = () => {
  const { downloads, selectedId, setSelectedId, speedHistory, chunks } = useDownloadStore();

  const selectedDownload = downloads.find((d) => d.id === selectedId);

  if (!selectedDownload) {
    return null;
  }

  const percentage: number | null = selectedDownload.status === 'completed'
    ? 100
    : (selectedDownload.file_size && selectedDownload.file_size > 0
        ? Math.min(100, Math.round((selectedDownload.downloaded_size / selectedDownload.file_size) * 100))
        : null); // null = indeterminate, never show a fake percentage

  const displayTotalSize = selectedDownload.file_size || (selectedDownload.status === 'completed' ? selectedDownload.downloaded_size : null);

  const maxSpeed = Math.max(...speedHistory.map((s) => s.speed), 1024 * 100);

  const handleOpenFolder = () => {
    invoke('show_in_folder', { path: selectedDownload.file_path });
  };

  const handleOpenFile = () => {
    if (selectedDownload.file_exists === false) {
      alert('This file does not exist on disk (it was deleted or moved from the folder).');
      return;
    }
    invoke('open_file_or_dir', { path: selectedDownload.file_path });
  };

  return (
    <aside className="w-80 border-l border-border/80 bg-card/50 backdrop-blur-md flex flex-col h-full overflow-hidden select-none flex-shrink-0 text-xs z-10">
      {/* Header */}
      <div className="p-3 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-2 truncate pr-2">
          <Activity className="w-4 h-4 text-primary flex-shrink-0" />
          <span className="font-semibold text-foreground truncate" title={selectedDownload.file_name}>
            {selectedDownload.file_name}
          </span>
        </div>
        <button
          onClick={() => setSelectedId(null)}
          className="p-1 rounded hover:bg-secondary text-muted-foreground hover:text-foreground transition cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Scrollable Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-5">
        {/* Speed Graph */}
        <div className="space-y-2">
          <div className="flex justify-between items-center text-[11px]">
            <span className="text-muted-foreground font-medium flex items-center gap-1.5">
              <Zap className="w-3.5 h-3.5 text-primary" /> Live Speed (60s)
            </span>
            <span className="font-mono text-primary font-semibold">
              {formatSpeed(selectedDownload.speed)}
            </span>
          </div>
          <div className="h-20 w-full bg-background/60 rounded-lg p-2 border border-border/60 flex items-end gap-[2px] overflow-hidden">
            {speedHistory.map((sample, idx) => {
              const heightPercent = Math.max(4, Math.round((sample.speed / maxSpeed) * 100));
              return (
                <div
                  key={idx}
                  className="flex-1 bg-gradient-to-t from-primary/40 to-primary rounded-t-[1px] transition-all duration-300"
                  style={{ height: `${heightPercent}%` }}
                  title={`${sample.time}: ${formatSpeed(sample.speed)}`}
                />
              );
            })}
          </div>
        </div>

        {/* Multi-Connection Chunks Visualizer */}
        {chunks.length > 0 && (
          <div className="space-y-2">
            <div className="flex justify-between items-center text-[11px]">
              <span className="text-muted-foreground font-medium flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5 text-indigo-400" />
                Connection Threads ({chunks.length})
              </span>
              <span className="text-[10px] text-muted-foreground font-mono">
                {chunks.filter((c) => c.status === 'completed').length} / {chunks.length} done
              </span>
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              {chunks.map((chunk) => {
                const totalChunk = chunk.end_byte - chunk.start_byte + 1;
                const cPercent = totalChunk > 0
                  ? Math.min(100, Math.round((chunk.downloaded_bytes / totalChunk) * 100))
                  : 0;

                return (
                  <div
                    key={chunk.id}
                    className="p-1.5 rounded bg-background/40 border border-border/40 space-y-1"
                  >
                    <div className="flex justify-between text-[10px] text-muted-foreground font-mono">
                      <span>Thread #{chunk.chunk_index + 1}</span>
                      <span>{cPercent}%</span>
                    </div>
                    <div className="w-full bg-secondary/80 rounded-full h-1 overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-300 ${
                          chunk.status === 'completed'
                            ? 'bg-emerald-500'
                            : 'bg-primary'
                        }`}
                        style={{ width: `${cPercent}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Download Metrics Grid */}
        <div className="space-y-2">
          <div className="text-[11px] font-medium text-muted-foreground">Metrics</div>
          <div className="grid grid-cols-2 gap-2 text-[11px]">
            <div className="p-2 rounded-lg bg-background/50 border border-border/40 space-y-0.5">
              <span className="text-muted-foreground">Total Size</span>
              <div className="font-mono font-semibold text-foreground">
                {formatBytes(displayTotalSize)}
              </div>
            </div>
            <div className="p-2 rounded-lg bg-background/50 border border-border/40 space-y-0.5">
              <span className="text-muted-foreground">Downloaded</span>
              <div className="font-mono font-semibold text-foreground">
                {formatBytes(selectedDownload.downloaded_size)}
              </div>
            </div>
            <div className="p-2 rounded-lg bg-background/50 border border-border/40 space-y-0.5">
              <span className="text-muted-foreground">Average Speed</span>
              <div className="font-mono font-semibold text-foreground">
                {formatSpeed(selectedDownload.average_speed)}
              </div>
            </div>
            <div className="p-2 rounded-lg bg-background/50 border border-border/40 space-y-0.5">
              <span className="text-muted-foreground">ETA Remaining</span>
              <div className="font-mono font-semibold text-foreground">
                {formatEta(selectedDownload.eta)}
              </div>
            </div>
          </div>
        </div>

        {/* File & Source Information */}
        <div className="space-y-3">
          <div className="text-[11px] font-medium text-muted-foreground">File & Source</div>

          <div className="space-y-1">
            <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">
              Source URL
            </span>
            <div className="p-2 rounded bg-background/50 border border-border/40 font-mono text-[10px] break-all text-muted-foreground max-h-16 overflow-y-auto">
              {selectedDownload.url}
            </div>
          </div>

          <div className="space-y-1">
            <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">
              Destination Path
            </span>
            <div className="p-2 rounded bg-background/50 border border-border/40 font-mono text-[10px] break-all text-muted-foreground">
              {selectedDownload.file_path}
            </div>
          </div>

          <div className="flex gap-2 pt-1">
            <button
              onClick={handleOpenFolder}
              className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md bg-secondary hover:bg-secondary/80 text-foreground font-medium transition cursor-pointer"
            >
              <Folder className="w-3.5 h-3.5 text-muted-foreground" />
              <span>Show in Folder</span>
            </button>
            {selectedDownload.status === 'completed' && (
              <button
                onClick={handleOpenFile}
                disabled={selectedDownload.file_exists === false}
                className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md font-medium transition cursor-pointer ${
                  selectedDownload.file_exists === false
                    ? 'bg-rose-500/10 text-rose-400 border border-rose-500/20 cursor-not-allowed opacity-80'
                    : 'bg-primary hover:bg-primary/90 text-primary-foreground'
                }`}
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span>{selectedDownload.file_exists === false ? 'Not Exist' : 'Open File'}</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </aside>
  );
};
