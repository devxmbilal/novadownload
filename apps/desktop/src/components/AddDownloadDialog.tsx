import React, { useState, useEffect } from 'react';
import {
  X,
  Download,
  Clock,
  Folder,
  Sliders,
  CheckCircle,
  AlertCircle,
  Loader2,
  Sparkles,
} from 'lucide-react';
import { useDownloadStore } from '../stores/downloadStore';
import { useUIStore } from '../stores/uiStore';
import { useSettingsStore } from '../stores/settingsStore';
import { formatBytes } from '../lib/utils';
import { UrlProbeResult } from '../types';
import { readText } from '@tauri-apps/plugin-clipboard-manager';

export const AddDownloadDialog: React.FC = () => {
  const { isAddDialogOpen, prefilledUrl, closeAddDialog } = useUIStore();
  const { addDownload, probeUrl } = useDownloadStore();
  const { settings } = useSettingsStore();

  const [url, setUrl] = useState('');
  const [fileName, setFileName] = useState('');
  const [directory, setDirectory] = useState('');
  const [category, setCategory] = useState('Other');
  const [connections, setConnections] = useState(4);
  const [speedLimit, setSpeedLimit] = useState(0);
  const [startImmediately, setStartImmediately] = useState(true);

  const [isProbing, setIsProbing] = useState(false);
  const [probeResult, setProbeResult] = useState<UrlProbeResult | null>(null);
  const [probeError, setProbeError] = useState<string | null>(null);

  useEffect(() => {
    if (isAddDialogOpen) {
      if (prefilledUrl) {
        setUrl(prefilledUrl);
        handleProbe(prefilledUrl);
      } else {
        // Try reading clipboard
        readText()
          .then((text) => {
            if (text && (text.startsWith('http://') || text.startsWith('https://'))) {
              setUrl(text);
              handleProbe(text);
            }
          })
          .catch(() => {});
      }

      if (settings) {
        setDirectory(settings.default_download_directory);
        setConnections(settings.default_connections || 4);
      }
    } else {
      // Reset
      setUrl('');
      setFileName('');
      setProbeResult(null);
      setProbeError(null);
    }
  }, [isAddDialogOpen, prefilledUrl, settings]);

  const handleProbe = async (targetUrl: string) => {
    const trimmed = targetUrl.trim();
    if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
      return;
    }

    setIsProbing(true);
    setProbeError(null);

    try {
      const res = await probeUrl(trimmed);
      setProbeResult(res);
      setFileName(res.file_name);
      setCategory(res.suggested_category);
    } catch (e: any) {
      setProbeError('Could not fetch URL metadata (will download directly)');
    } finally {
      setIsProbing(false);
    }
  };

  const handleSubmit = async (startNow: boolean) => {
    if (!url.trim()) return;

    try {
      await addDownload({
        url: url.trim(),
        file_name: fileName.trim() || undefined,
        directory: directory.trim() || undefined,
        category,
        connections,
        start_immediately: startNow,
        speed_limit: speedLimit > 0 ? speedLimit : undefined,
      });
      closeAddDialog();
    } catch (e: any) {
      alert(`Error creating download: ${e}`);
    }
  };

  if (!isAddDialogOpen) return null;

  return (
    <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 select-none">
      <div className="w-full max-w-lg bg-card border border-border rounded-xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="p-4 border-b border-border flex items-center justify-between bg-card/90">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-md bg-primary/20 text-primary flex items-center justify-center">
              <Download className="w-4 h-4" />
            </div>
            <h3 className="font-semibold text-sm text-foreground">Add New Download</h3>
          </div>
          <button
            onClick={closeAddDialog}
            className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary transition cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4 text-xs">
          {/* URL Input */}
          <div className="space-y-1.5">
            <label className="font-medium text-foreground">Download URL</label>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="https://example.com/file.zip"
                value={url}
                onChange={(e) => {
                  setUrl(e.target.value);
                  if (e.target.value.length > 8) {
                    handleProbe(e.target.value);
                  }
                }}
                className="flex-1 px-3 py-2 rounded-md bg-secondary/60 border border-border focus:border-primary focus:bg-background outline-none transition font-mono text-xs text-foreground"
                autoFocus
              />
              <button
                type="button"
                onClick={() => handleProbe(url)}
                disabled={isProbing || !url}
                className="px-3 py-2 rounded-md bg-secondary hover:bg-secondary/80 font-medium text-foreground transition flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                {isProbing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5 text-primary" />}
                <span>Probe</span>
              </button>
            </div>
          </div>

          {/* Probe Info Box */}
          {probeResult && (
            <div className="p-3 rounded-lg bg-secondary/30 border border-border/60 flex items-center justify-between text-[11px]">
              <div>
                <span className="text-muted-foreground">Size: </span>
                <span className="font-mono font-semibold text-foreground">
                  {formatBytes(probeResult.file_size)}
                </span>
                {probeResult.accept_ranges && (
                  <span className="ml-2 px-1.5 py-0.2 rounded bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 font-medium text-[10px]">
                    Multi-Connection Supported
                  </span>
                )}
              </div>
              <div className="text-muted-foreground">
                Type: <span className="text-foreground">{probeResult.mime_type || 'Unknown'}</span>
              </div>
            </div>
          )}

          {probeError && (
            <div className="p-2 rounded bg-amber-500/10 border border-amber-500/20 text-amber-500 text-[11px] flex items-center gap-1.5">
              <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
              <span>{probeError}</span>
            </div>
          )}

          {/* File Name */}
          <div className="space-y-1.5">
            <label className="font-medium text-foreground">File Name</label>
            <input
              type="text"
              placeholder="filename.ext"
              value={fileName}
              onChange={(e) => setFileName(e.target.value)}
              className="w-full px-3 py-2 rounded-md bg-secondary/60 border border-border focus:border-primary focus:bg-background outline-none transition text-xs text-foreground font-mono"
            />
          </div>

          {/* Directory & Category */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="font-medium text-foreground">Category</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full px-3 py-2 rounded-md bg-secondary/60 border border-border focus:border-primary focus:bg-background outline-none transition text-xs text-foreground cursor-pointer"
              >
                <option value="Videos">Videos</option>
                <option value="Music">Music</option>
                <option value="Documents">Documents</option>
                <option value="Images">Images</option>
                <option value="Archives">Archives</option>
                <option value="Programs">Programs</option>
                <option value="Other">Other</option>
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="font-medium text-foreground">Connections (Threads)</label>
              <select
                value={connections}
                onChange={(e) => setConnections(parseInt(e.target.value, 10))}
                className="w-full px-3 py-2 rounded-md bg-secondary/60 border border-border focus:border-primary focus:bg-background outline-none transition text-xs text-foreground cursor-pointer"
              >
                <option value={1}>1 (Single Stream)</option>
                <option value={2}>2 Threads</option>
                <option value={4}>4 Threads (Recommended)</option>
                <option value={8}>8 Threads</option>
                <option value={16}>16 Threads (Max)</option>
              </select>
            </div>
          </div>

          {/* Save Directory */}
          <div className="space-y-1.5">
            <label className="font-medium text-foreground">Save Destination</label>
            <input
              type="text"
              value={directory}
              onChange={(e) => setDirectory(e.target.value)}
              className="w-full px-3 py-2 rounded-md bg-secondary/60 border border-border focus:border-primary focus:bg-background outline-none transition text-xs text-foreground font-mono"
            />
          </div>
        </div>

        {/* Footer Actions */}
        <div className="p-4 border-t border-border flex items-center justify-between bg-card/90">
          <button
            type="button"
            onClick={closeAddDialog}
            className="px-3 py-1.5 rounded-md hover:bg-secondary text-muted-foreground hover:text-foreground text-xs font-medium transition cursor-pointer"
          >
            Cancel
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => handleSubmit(false)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-secondary hover:bg-secondary/80 text-foreground text-xs font-semibold transition cursor-pointer"
            >
              <Clock className="w-3.5 h-3.5" />
              <span>Queue</span>
            </button>

            <button
              type="button"
              onClick={() => handleSubmit(true)}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-md bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-semibold shadow-md shadow-primary/30 transition active:scale-95 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Start Download</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
