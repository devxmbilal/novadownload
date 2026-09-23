import React, { useEffect, useRef } from 'react';
import {
  Play,
  Pause,
  Folder,
  File,
  Copy,
  Trash2,
  ExternalLink,
  RotateCcw,
} from 'lucide-react';
import { useDownloadStore } from '../stores/downloadStore';
import { useUIStore } from '../stores/uiStore';
import { invoke } from '@tauri-apps/api/core';

export const ContextMenu: React.FC = () => {
  const { downloads, pauseDownload, resumeDownload, deleteDownload } = useDownloadStore();
  const { contextMenu, closeContextMenu } = useUIStore();
  const menuRef = useRef<HTMLDivElement>(null);

  const download = downloads.find((d) => d.id === contextMenu.downloadId);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        closeContextMenu();
      }
    };
    if (contextMenu.isOpen) {
      window.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      window.removeEventListener('mousedown', handleClickOutside);
    };
  }, [contextMenu.isOpen, closeContextMenu]);

  if (!contextMenu.isOpen || !download) return null;

  const handleOpenFile = () => {
    invoke('open_file_or_dir', { path: download.file_path });
    closeContextMenu();
  };

  const handleShowFolder = () => {
    invoke('show_in_folder', { path: download.file_path });
    closeContextMenu();
  };

  const handleCopyUrl = () => {
    navigator.clipboard.writeText(download.url);
    closeContextMenu();
  };

  const handleCopyPath = () => {
    navigator.clipboard.writeText(download.file_path);
    closeContextMenu();
  };

  const handleDelete = (deleteFiles = false) => {
    deleteDownload(download.id, deleteFiles);
    closeContextMenu();
  };

  return (
    <div
      ref={menuRef}
      style={{ top: `${contextMenu.y}px`, left: `${contextMenu.x}px` }}
      className="fixed z-50 min-w-44 bg-popover text-popover-foreground border border-border/80 rounded-lg shadow-xl p-1 text-xs select-none animate-in fade-in zoom-in-95 duration-100"
    >
      {download.status === 'downloading' ? (
        <button
          onClick={() => {
            pauseDownload(download.id);
            closeContextMenu();
          }}
          className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded hover:bg-secondary text-amber-500 font-medium transition cursor-pointer"
        >
          <Pause className="w-3.5 h-3.5" />
          <span>Pause Download</span>
        </button>
      ) : download.status === 'paused' || download.status === 'failed' || download.status === 'queued' ? (
        <button
          onClick={() => {
            resumeDownload(download.id);
            closeContextMenu();
          }}
          className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded hover:bg-secondary text-emerald-500 font-medium transition cursor-pointer"
        >
          <Play className="w-3.5 h-3.5" />
          <span>Resume Download</span>
        </button>
      ) : null}

      <div className="h-[1px] bg-border my-1" />

      {download.status === 'completed' && (
        <button
          onClick={handleOpenFile}
          className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded hover:bg-secondary text-foreground font-medium transition cursor-pointer"
        >
          <ExternalLink className="w-3.5 h-3.5 text-muted-foreground" />
          <span>Open File</span>
        </button>
      )}

      <button
        onClick={handleShowFolder}
        className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded hover:bg-secondary text-foreground font-medium transition cursor-pointer"
      >
        <Folder className="w-3.5 h-3.5 text-muted-foreground" />
        <span>Open Containing Folder</span>
      </button>

      <button
        onClick={handleCopyUrl}
        className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded hover:bg-secondary text-foreground font-medium transition cursor-pointer"
      >
        <Copy className="w-3.5 h-3.5 text-muted-foreground" />
        <span>Copy URL</span>
      </button>

      <button
        onClick={handleCopyPath}
        className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded hover:bg-secondary text-foreground font-medium transition cursor-pointer"
      >
        <File className="w-3.5 h-3.5 text-muted-foreground" />
        <span>Copy File Path</span>
      </button>

      <div className="h-[1px] bg-border my-1" />

      <button
        onClick={() => handleDelete(false)}
        className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded hover:bg-destructive/15 text-destructive font-medium transition cursor-pointer"
      >
        <Trash2 className="w-3.5 h-3.5" />
        <span>Remove from List</span>
      </button>

      <button
        onClick={() => handleDelete(true)}
        className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded hover:bg-destructive/15 text-destructive font-medium transition cursor-pointer"
      >
        <Trash2 className="w-3.5 h-3.5" />
        <span>Delete File from Disk</span>
      </button>
    </div>
  );
};
