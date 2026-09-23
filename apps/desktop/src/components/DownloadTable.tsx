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
  RotateCcw,
  ExternalLink,
} from 'lucide-react';
import { useDownloadStore } from '../stores/downloadStore';
import { useUIStore } from '../stores/uiStore';
import { formatBytes, formatSpeed, formatEta, getCategoryFromFilename } from '../lib/utils';
import { Download, DownloadStatus } from '../types';
import { invoke } from '@tauri-apps/api/core';

export const DownloadTable: React.FC = () => {
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
    // Status filter
    if (activeStatus !== 'all' && d.status !== activeStatus) {
      return false;
    }

    // Category filter
    if (activeCategory !== 'All') {
      const cat = getCategoryFromFilename(d.file_name, d.mime_type);
      if (cat !== activeCategory) return false;
    }

    // Search filter
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
        return <Video className="w-4 h-4 text-purple-400" />;
      case 'Music':
        return <Music className="w-4 h-4 text-pink-400" />;
      case 'Documents':
        return <FileText className="w-4 h-4 text-blue-400" />;
      case 'Images':
        return <ImageIcon className="w-4 h-4 text-emerald-400" />;
      case 'Archives':
        return <Archive className="w-4 h-4 text-amber-400" />;
      case 'Programs':
        return <Cpu className="w-4 h-4 text-indigo-400" />;
      default:
        return <File className="w-4 h-4 text-muted-foreground" />;
    }
  };

  const getStatusBadge = (status: DownloadStatus) => {
    switch (status) {
      case 'downloading':
        return (
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-primary/15 text-primary border border-primary/20 animate-pulse-subtle">
            <span className="w-1.5 h-1.5 rounded-full bg-primary animate-ping" />
            Downloading
          </span>
        );
      case 'completed':
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/15 text-emerald-500 border border-emerald-500/20">
            Completed
          </span>
        );
      case 'paused':
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-500/15 text-amber-500 border border-amber-500/20">
            Paused
          </span>
        );
      case 'failed':
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-rose-500/15 text-rose-500 border border-rose-500/20">
            Failed
          </span>
        );
      case 'queued':
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-indigo-500/15 text-indigo-400 border border-indigo-500/20">
            Queued
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-muted text-muted-foreground">
            {status}
          </span>
        );
    }
  };

  const handleRowContextMenu = (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    setSelectedId(id);
    openContextMenu(e.clientX, e.clientY, id);
  };

  const handleOpenFile = (path: string) => {
    invoke('open_file_or_dir', { path });
  };

  const handleShowInFolder = (path: string) => {
    invoke('show_in_folder', { path });
  };

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-background">
      {/* Table Content */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-left text-xs border-collapse">
          <thead className="sticky top-0 bg-card/90 backdrop-blur-md text-muted-foreground border-b border-border/80 z-10 select-none">
            <tr>
              <th className="py-2.5 px-3 font-semibold w-72">File Name</th>
              <th className="py-2.5 px-2 font-semibold w-24">Status</th>
              <th className="py-2.5 px-3 font-semibold w-48">Progress</th>
              <th className="py-2.5 px-2 font-semibold w-20">Size</th>
              <th className="py-2.5 px-2 font-semibold w-24">Downloaded</th>
              <th className="py-2.5 px-2 font-semibold w-20">Speed</th>
              <th className="py-2.5 px-2 font-semibold w-16">ETA</th>
              <th className="py-2.5 px-2 font-semibold w-16">Conn</th>
              <th className="py-2.5 px-3 font-semibold text-right w-28">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/30">
            {filteredDownloads.length === 0 ? (
              <tr>
                <td colSpan={9} className="py-20 text-center text-muted-foreground">
                  <div className="flex flex-col items-center justify-center gap-2">
                    <File className="w-8 h-8 opacity-30" />
                    <span>No downloads found</span>
                  </div>
                </td>
              </tr>
            ) : (
              filteredDownloads.map((dl) => {
                const isSelected = selectedId === dl.id;
                const percentage = dl.file_size
                  ? Math.min(100, Math.round((dl.downloaded_size / dl.file_size) * 100))
                  : 0;

                return (
                  <tr
                    key={dl.id}
                    onClick={() => setSelectedId(dl.id)}
                    onDoubleClick={() => {
                      if (dl.status === 'completed') {
                        handleOpenFile(dl.file_path);
                      }
                    }}
                    onContextMenu={(e) => handleRowContextMenu(e, dl.id)}
                    className={`transition group hover:bg-muted/40 cursor-pointer select-none ${
                      isSelected ? 'table-row-selected' : ''
                    }`}
                  >
                    {/* File Name & Icon */}
                    <td className="py-2.5 px-3 max-w-xs truncate">
                      <div className="flex items-center gap-2">
                        {getFileIcon(dl.file_name, dl.mime_type)}
                        <span className="font-medium text-foreground truncate" title={dl.file_name}>
                          {dl.file_name}
                        </span>
                      </div>
                    </td>

                    {/* Status Badge */}
                    <td className="py-2.5 px-2 whitespace-nowrap">{getStatusBadge(dl.status)}</td>

                    {/* Progress Bar & Percentage */}
                    <td className="py-2.5 px-3">
                      <div className="space-y-1">
                        <div className="flex justify-between text-[11px] font-mono">
                          <span>{percentage}%</span>
                        </div>
                        <div className="w-full bg-secondary/80 rounded-full h-1.5 overflow-hidden">
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
                    </td>

                    {/* Size */}
                    <td className="py-2.5 px-2 text-muted-foreground whitespace-nowrap font-mono">
                      {formatBytes(dl.file_size)}
                    </td>

                    {/* Downloaded */}
                    <td className="py-2.5 px-2 text-muted-foreground whitespace-nowrap font-mono">
                      {formatBytes(dl.downloaded_size)}
                    </td>

                    {/* Speed */}
                    <td className="py-2.5 px-2 whitespace-nowrap font-mono">
                      {dl.status === 'downloading' ? (
                        <span className="text-primary font-semibold">{formatSpeed(dl.speed)}</span>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </td>

                    {/* ETA */}
                    <td className="py-2.5 px-2 whitespace-nowrap font-mono text-muted-foreground">
                      {dl.status === 'downloading' ? formatEta(dl.eta) : '-'}
                    </td>

                    {/* Connections */}
                    <td className="py-2.5 px-2 whitespace-nowrap font-mono text-muted-foreground">
                      {dl.status === 'downloading' ? `${dl.active_connections}/${dl.total_connections}` : dl.total_connections}
                    </td>

                    {/* Actions */}
                    <td className="py-2.5 px-3 text-right whitespace-nowrap">
                      <div className="flex items-center justify-end gap-1 opacity-80 group-hover:opacity-100">
                        {dl.status === 'downloading' ? (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              pauseDownload(dl.id);
                            }}
                            className="p-1 hover:bg-secondary rounded text-amber-500 transition"
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
                            className="p-1 hover:bg-secondary rounded text-emerald-500 transition"
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
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
