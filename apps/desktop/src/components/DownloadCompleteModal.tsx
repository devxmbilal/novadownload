import React from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  CheckCircle2,
  Folder,
  Play,
  X,
  FileVideo,
  FileAudio,
  FileText,
  FileArchive,
  FileCode,
  File as GenericFile,
} from 'lucide-react';
import { useUIStore } from '../stores/uiStore';
import { formatBytes } from '@novadownload/shared-utils';

export const DownloadCompleteModal: React.FC = () => {
  const { completedDownload, closeCompleteModal } = useUIStore();

  if (!completedDownload) return null;

  const handleOpenFile = () => {
    invoke('open_file_or_dir', { path: completedDownload.file_path });
    closeCompleteModal();
  };

  const handleShowInFolder = () => {
    invoke('show_in_folder', { path: completedDownload.file_path });
    closeCompleteModal();
  };

  const getFileIcon = (fileName: string, mime?: string | null) => {
    const ext = fileName.split('.').pop()?.toLowerCase() || '';
    if (['mp4', 'mkv', 'avi', 'mov', 'webm', 'flv'].includes(ext) || mime?.startsWith('video/')) {
      return <FileVideo className="w-8 h-8 text-indigo-400" />;
    }
    if (['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a'].includes(ext) || mime?.startsWith('audio/')) {
      return <FileAudio className="w-8 h-8 text-pink-400" />;
    }
    if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) {
      return <FileArchive className="w-8 h-8 text-amber-400" />;
    }
    if (['pdf', 'doc', 'docx', 'txt', 'rtf'].includes(ext)) {
      return <FileText className="w-8 h-8 text-emerald-400" />;
    }
    if (['js', 'ts', 'rs', 'py', 'json', 'html', 'css'].includes(ext)) {
      return <FileCode className="w-8 h-8 text-cyan-400" />;
    }
    return <GenericFile className="w-8 h-8 text-muted-foreground" />;
  };

  const displaySize = completedDownload.file_size || completedDownload.downloaded_size;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="bg-card border border-border/80 w-full max-w-md rounded-xl shadow-2xl overflow-hidden flex flex-col scale-in-95 transition-all">
        {/* Top Header */}
        <div className="relative px-5 pt-5 pb-3 flex items-center justify-between border-b border-border/50 bg-gradient-to-r from-emerald-500/10 via-primary/5 to-transparent">
          <div className="flex items-center gap-2 text-emerald-400 font-semibold text-sm">
            <div className="p-1 rounded-full bg-emerald-500/20 border border-emerald-500/30">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            </div>
            <span>Download Completed</span>
          </div>
          <button
            onClick={closeCompleteModal}
            className="p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-5 space-y-4">
          <div className="flex items-center gap-3.5 p-3 rounded-lg bg-secondary/40 border border-border/50">
            {completedDownload.thumbnail ? (
              <div className="w-20 h-14 rounded-md overflow-hidden bg-background border border-border flex-shrink-0">
                <img
                  src={completedDownload.thumbnail}
                  alt={completedDownload.file_name}
                  className="w-full h-full object-cover"
                />
              </div>
            ) : (
              <div className="w-14 h-14 rounded-md bg-background/80 border border-border flex items-center justify-center flex-shrink-0">
                {getFileIcon(completedDownload.file_name, completedDownload.mime_type)}
              </div>
            )}

            <div className="flex-1 min-w-0">
              <h4
                className="font-semibold text-foreground text-xs leading-snug line-clamp-2 select-text"
                title={completedDownload.file_name}
              >
                {completedDownload.file_name}
              </h4>
              <div className="flex items-center gap-2 mt-1.5 text-[11px] text-muted-foreground">
                <span className="font-mono text-foreground/80 font-medium">
                  {formatBytes(displaySize)}
                </span>
                <span>•</span>
                <span className="px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400 text-[10px] font-semibold">
                  100% Ready
                </span>
              </div>
            </div>
          </div>

          <div className="text-[11px] text-muted-foreground break-all px-1 select-text">
            <span className="font-semibold text-foreground/70">Location: </span>
            <span className="font-mono text-[10px]">{completedDownload.file_path}</span>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="px-5 py-3.5 bg-secondary/20 border-t border-border/50 flex items-center justify-end gap-2.5">
          <button
            onClick={closeCompleteModal}
            className="px-3.5 py-1.5 rounded-lg text-xs text-muted-foreground hover:text-foreground hover:bg-secondary transition font-medium"
          >
            Close
          </button>

          <button
            onClick={handleShowInFolder}
            className="px-3.5 py-1.5 rounded-lg bg-secondary text-foreground hover:bg-secondary/80 border border-border/80 transition flex items-center gap-1.5 text-xs font-semibold"
          >
            <Folder className="w-3.5 h-3.5 text-primary" />
            <span>Open Folder</span>
          </button>

          <button
            onClick={handleOpenFile}
            className="px-4 py-1.5 rounded-lg bg-primary text-white hover:bg-primary/90 shadow-sm shadow-primary/20 transition flex items-center gap-1.5 text-xs font-semibold"
          >
            <Play className="w-3.5 h-3.5" />
            <span>Open File</span>
          </button>
        </div>
      </div>
    </div>
  );
};
