import React from 'react';
import {
  Play,
  Pause,
  Folder,
  Trash2,
  File,
  Video,
  Music,
  FileText,
  Image as ImageIcon,
  Archive,
  Cpu,
  Clock,
  ExternalLink,
} from 'lucide-react';
import { useDownloadStore } from '../stores/downloadStore';
import { useUIStore } from '../stores/uiStore';
import { formatBytes, formatSpeed, formatEta, getCategoryFromFilename } from '../lib/utils';
import { Download, DownloadStatus } from '../types';
import { invoke } from '@tauri-apps/api/core';

export const DownloadGridView: React.FC = () => {
  const {
    downloads,
    selectedId,
    activeCategory,
    activeStatus,
    searchQuery,
    setSelectedId,
    pauseDownload,
    resumeDownload,
    deleteDownload,
  } = useDownloadStore();

  const { openContextMenu } = useUIStore();

  // Filter downloads
  const filteredDownloads = downloads.filter((d) => {
    if (activeStatus !== 'all' && d.status !== activeStatus) return false;
    if (activeCategory !== 'All') {
      const cat = getCategoryFromFilename(d.file_name, d.mime_type);
      if (cat !== activeCategory) return false;
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchName = d.file_name.toLowerCase().includes(q);
      const matchUrl = d.url.toLowerCase().includes(q);
      if (!matchName && !matchUrl) return false;
    }
    return true;
  });

  const getFileIcon = (fileName: string, mimeType?: string | null) => {
    const cat = getCategoryFromFilename(fileName, mimeType);
    switch (cat) {
      case 'Videos':
        return <Video className="w-8 h-8 text-purple-400 opacity-60" />;
      case 'Music':
        return <Music className="w-8 h-8 text-pink-400 opacity-60" />;
      case 'Documents':
        return <FileText className="w-8 h-8 text-blue-400 opacity-60" />;
      case 'Images':
        return <ImageIcon className="w-8 h-8 text-emerald-400 opacity-60" />;
      case 'Archives':
        return <Archive className="w-8 h-8 text-amber-400 opacity-60" />;
      case 'Programs':
        return <Cpu className="w-8 h-8 text-indigo-400 opacity-60" />;
      default:
        return <File className="w-8 h-8 text-muted-foreground opacity-60" />;
    }
  };

  const getStatusBadge = (status: DownloadStatus) => {
    switch (status) {
      case 'downloading':
        return (
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-primary/20 text-primary border border-primary/30 backdrop-blur-sm">
            <span className="w-1.5 h-1.5 rounded-full bg-primary animate-ping" />
            Downloading
          </span>
        );
      case 'completed':
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 backdrop-blur-sm">
            Completed
          </span>
        );
      case 'paused':
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-500/20 text-amber-400 border border-amber-500/30 backdrop-blur-sm">
            Paused
          </span>
        );
      case 'failed':
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-rose-500/20 text-rose-400 border border-rose-500/30 backdrop-blur-sm">
            Failed
          </span>
        );
      case 'queued':
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 backdrop-blur-sm">
            Queued
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-muted/80 text-muted-foreground">
            {status}
          </span>
        );
    }
  };

  const handleOpenFile = (path: string) => {
    invoke('open_file_or_dir', { path });
  };

  const handleShowInFolder = (path: string) => {
    invoke('show_in_folder', { path });
  };

  if (filteredDownloads.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-2 text-muted-foreground bg-background">
        <File className="w-12 h-12 opacity-20" />
        <p className="text-sm font-medium">No downloads found</p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-4 bg-background">
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3.5">
        {filteredDownloads.map((dl) => {
          const isSelected = selectedId === dl.id;
          const percentage =
            dl.status === 'completed'
              ? 100
              : dl.file_size && dl.file_size > 0
              ? Math.min(100, Math.round((dl.downloaded_size / dl.file_size) * 100))
              : dl.downloaded_size > 0
              ? 50
              : 0;

          const displaySize = dl.file_size || (dl.status === 'completed' ? dl.downloaded_size : null);

          return (
            <div
              key={dl.id}
              onClick={() => setSelectedId(dl.id)}
              onDoubleClick={() => {
                if (dl.status === 'completed') {
                  handleOpenFile(dl.file_path);
                }
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                setSelectedId(dl.id);
                openContextMenu(e.clientX, e.clientY, dl.id);
              }}
              className={`group relative flex flex-col rounded-xl border bg-card/60 hover:bg-card/90 hover:border-primary/40 transition-all duration-200 overflow-hidden cursor-pointer shadow-sm hover:shadow-md ${
                isSelected ? 'border-primary ring-1 ring-primary/40 bg-card' : 'border-border/70'
              }`}
            >
              {/* Thumbnail / Header Banner */}
              <div className="relative w-full aspect-video bg-background/90 flex items-center justify-center overflow-hidden border-b border-border/40">
                {dl.thumbnail ? (
                  <img
                    src={dl.thumbnail}
                    alt={dl.file_name}
                    className="w-full h-full object-cover group-hover:scale-105 transition duration-300"
                    loading="lazy"
                  />
                ) : (
                  <div className="flex flex-col items-center justify-center p-4">
                    {getFileIcon(dl.file_name, dl.mime_type)}
                  </div>
                )}

                {/* Status Badge overlay */}
                <div className="absolute top-2 left-2">{getStatusBadge(dl.status)}</div>

                {/* Category tag */}
                <span className="absolute bottom-2 left-2 px-1.5 py-0.5 rounded bg-black/70 text-[9px] font-semibold text-white/90 uppercase tracking-wider backdrop-blur-sm">
                  {getCategoryFromFilename(dl.file_name, dl.mime_type)}
                </span>
              </div>

              {/* Card Body */}
              <div className="p-3 flex-1 flex flex-col justify-between space-y-2.5">
                <div>
                  <h4
                    className="font-medium text-xs text-foreground line-clamp-2 leading-snug group-hover:text-primary transition"
                    title={dl.file_name}
                  >
                    {dl.file_name}
                  </h4>
                </div>

                {/* Progress Bar */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-[10px] font-mono text-muted-foreground">
                    <span className="font-semibold text-foreground">{percentage}%</span>
                    <span>
                      {formatBytes(dl.downloaded_size)}
                      {displaySize ? ` / ${formatBytes(displaySize)}` : ''}
                    </span>
                  </div>
                  <div className="w-full bg-secondary/90 rounded-full h-1.5 overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-300 ${
                        dl.status === 'completed'
                          ? 'bg-emerald-500'
                          : dl.status === 'failed'
                          ? 'bg-rose-500'
                          : dl.status === 'paused'
                          ? 'bg-amber-500'
                          : 'bg-gradient-to-r from-primary to-nova-400'
                      }`}
                      style={{ width: `${percentage}%` }}
                    />
                  </div>
                </div>

                {/* Live Speed & ETA / Actions Bar */}
                <div className="pt-1 border-t border-border/40 flex items-center justify-between text-[11px]">
                  <div className="font-mono text-[10px]">
                    {dl.status === 'downloading' ? (
                      <span className="text-primary font-semibold">{formatSpeed(dl.speed)}</span>
                    ) : dl.status === 'completed' ? (
                      <span className="text-emerald-400">Done</span>
                    ) : (
                      <span className="text-muted-foreground">{dl.status}</span>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1 opacity-70 group-hover:opacity-100 transition">
                    {dl.status === 'downloading' ? (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          pauseDownload(dl.id);
                        }}
                        className="p-1 hover:bg-secondary rounded text-amber-400 transition"
                        title="Pause"
                      >
                        <Pause className="w-3.5 h-3.5" />
                      </button>
                    ) : dl.status === 'paused' || dl.status === 'failed' || dl.status === 'queued' ? (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          resumeDownload(dl.id);
                        }}
                        className="p-1 hover:bg-secondary rounded text-emerald-400 transition"
                        title="Resume"
                      >
                        <Play className="w-3.5 h-3.5" />
                      </button>
                    ) : null}

                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleShowInFolder(dl.file_path);
                      }}
                      className="p-1 hover:bg-secondary rounded text-muted-foreground hover:text-foreground transition"
                      title="Open folder"
                    >
                      <Folder className="w-3.5 h-3.5" />
                    </button>

                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteDownload(dl.id, false);
                      }}
                      className="p-1 hover:bg-destructive/20 rounded text-muted-foreground hover:text-destructive transition"
                      title="Delete"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
