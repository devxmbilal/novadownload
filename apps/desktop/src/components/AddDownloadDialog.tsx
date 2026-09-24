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
  Film,
  Music,
  Video,
  PlayCircle,
} from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { useDownloadStore } from '../stores/downloadStore';
import { useUIStore } from '../stores/uiStore';
import { useSettingsStore } from '../stores/settingsStore';
import { formatBytes } from '../lib/utils';
import { UrlProbeResult, MediaInfo, MediaFormat, MediaDownloadRequest } from '../types';
import { readText } from '@tauri-apps/plugin-clipboard-manager';

export const AddDownloadDialog: React.FC = () => {
  const { isAddDialogOpen, prefilledUrl, prefilledMediaOptions, closeAddDialog } = useUIStore();
  const { addDownload, probeUrl, fetchDownloads } = useDownloadStore();
  const { settings } = useSettingsStore();

  const [url, setUrl] = useState('');
  const [fileName, setFileName] = useState('');
  const [directory, setDirectory] = useState('');
  const [category, setCategory] = useState('Other');
  const [connections, setConnections] = useState(4);
  const [speedLimit, setSpeedLimit] = useState(0);

  const [isProbing, setIsProbing] = useState(false);
  const [probeResult, setProbeResult] = useState<UrlProbeResult | null>(null);
  const [probeError, setProbeError] = useState<string | null>(null);

  // Video / Media Extractor State
  const [isMediaUrl, setIsMediaUrl] = useState(false);
  const [isExtractingMedia, setIsExtractingMedia] = useState(false);
  const [mediaInfo, setMediaInfo] = useState<MediaInfo | null>(null);
  const [selectedFormatId, setSelectedFormatId] = useState<string>('best');
  const [isAudioOnly, setIsAudioOnly] = useState(false);

  const checkIfMediaUrl = (inputUrl: string): boolean => {
    const u = inputUrl.toLowerCase();
    return (
      u.includes('youtube.com') ||
      u.includes('youtu.be') ||
      u.includes('tiktok.com') ||
      u.includes('facebook.com') ||
      u.includes('fb.watch') ||
      u.includes('instagram.com') ||
      u.includes('twitter.com') ||
      u.includes('x.com') ||
      u.includes('vimeo.com') ||
      u.includes('reddit.com') ||
      u.includes('dailymotion.com') ||
      u.includes('twitch.tv') ||
      u.includes('soundcloud.com')
    );
  };

  useEffect(() => {
    if (isAddDialogOpen) {
      if (prefilledMediaOptions) {
        if (prefilledMediaOptions.formatId) {
          setSelectedFormatId(prefilledMediaOptions.formatId);
        }
        if (typeof prefilledMediaOptions.isAudioOnly === 'boolean') {
          setIsAudioOnly(prefilledMediaOptions.isAudioOnly);
          setCategory(prefilledMediaOptions.isAudioOnly ? 'Music' : 'Videos');
        }
        if (prefilledMediaOptions.title) {
          setFileName(prefilledMediaOptions.title);
        }
      }

      if (prefilledUrl) {
        setUrl(prefilledUrl);
        handleUrlChange(prefilledUrl);
      } else {
        // Try reading clipboard
        readText()
          .then((text) => {
            if (text && (text.startsWith('http://') || text.startsWith('https://'))) {
              setUrl(text);
              handleUrlChange(text);
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
      setIsMediaUrl(false);
      setMediaInfo(null);
      setIsAudioOnly(false);
      setSelectedFormatId('best');
    }
  }, [isAddDialogOpen, prefilledUrl, prefilledMediaOptions, settings]);

  const handleUrlChange = (targetUrl: string) => {
    const trimmed = targetUrl.trim();
    if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
      return;
    }

    if (checkIfMediaUrl(trimmed)) {
      setIsMediaUrl(true);
      setProbeResult(null);
      handleExtractMedia(trimmed);
    } else {
      setIsMediaUrl(false);
      setMediaInfo(null);
      handleProbe(trimmed);
    }
  };

  const handleExtractMedia = async (targetUrl: string) => {
    setIsExtractingMedia(true);
    setProbeError(null);
    try {
      const info = await invoke<MediaInfo>('extract_media_info', { url: targetUrl });
      setMediaInfo(info);
      setFileName((prev) => prev.trim() || info.title);
      setCategory(isAudioOnly ? 'Music' : 'Videos');
      if (prefilledMediaOptions?.formatId) {
        setSelectedFormatId(prefilledMediaOptions.formatId);
      }
    } catch (e: any) {
      setProbeError(`Video extraction: ${e?.toString() || 'Could not parse media'}.`);
    } finally {
      setIsExtractingMedia(false);
    }
  };

  const handleProbe = async (targetUrl: string) => {
    setIsProbing(true);
    setProbeError(null);

    try {
      const res = await probeUrl(targetUrl);
      setProbeResult(res);
      setFileName(res.file_name);
      setCategory(res.suggested_category);
    } catch (e: any) {
      setProbeError('Could not fetch URL metadata (will download directly)');
    } finally {
      setIsProbing(false);
    }
  };

  const handleMediaDownloadSubmit = async () => {
    if (!url.trim()) return;

    try {
      let calculatedSize: number | undefined = undefined;
      if (isAudioOnly) {
        const audioFmts = mediaInfo?.formats.filter((f) => f.has_audio && !f.has_video);
        const bestAud = audioFmts?.sort((a, b) => (b.filesize || b.filesize_approx || 0) - (a.filesize || a.filesize_approx || 0))[0];
        calculatedSize = bestAud?.filesize || bestAud?.filesize_approx || prefilledMediaOptions?.fileSize || undefined;
      } else if (selectedFormatId === 'best') {
        const bestFmt = mediaInfo?.formats
          .filter((f) => f.has_video)
          .sort((a, b) => (b.filesize || b.filesize_approx || 0) - (a.filesize || a.filesize_approx || 0))[0];
        calculatedSize = bestFmt?.filesize || bestFmt?.filesize_approx || prefilledMediaOptions?.fileSize || undefined;
      } else {
        const fmt = mediaInfo?.formats.find((f) => f.format_id === selectedFormatId);
        calculatedSize = fmt?.filesize || fmt?.filesize_approx || prefilledMediaOptions?.fileSize || undefined;
      }

      const request: MediaDownloadRequest = {
        url: url.trim(),
        format_id: selectedFormatId,
        is_audio_only: isAudioOnly,
        directory: directory.trim() || undefined,
        file_name: fileName.trim() || (mediaInfo?.title ?? 'media_download'),
        thumbnail: mediaInfo?.thumbnail || undefined,
        file_size: calculatedSize,
      };

      await invoke('create_media_download', { request });
      await fetchDownloads();
      closeAddDialog();
    } catch (e: any) {
      alert(`Error starting video download: ${e}`);
    }
  };

  const handleSubmit = async (startNow: boolean) => {
    if (!url.trim()) return;

    if (isMediaUrl) {
      if (mediaInfo) {
        await handleMediaDownloadSubmit();
        return;
      }
      // If mediaInfo is still extracting or not yet loaded, DO NOT fall back to direct HTTP GET!
      // Direct HTTP GET downloads YouTube's 1 KB HTML redirect page.
      // Instead, trigger create_media_download with format 'best' or prefilled options.
      try {
        const request: MediaDownloadRequest = {
          url: url.trim(),
          format_id: selectedFormatId || prefilledMediaOptions?.formatId || 'best',
          is_audio_only: isAudioOnly || !!prefilledMediaOptions?.isAudioOnly,
          directory: directory.trim() || undefined,
          file_name: fileName.trim() || prefilledMediaOptions?.title || undefined,
          file_size: prefilledMediaOptions?.fileSize || undefined,
        };
        await invoke('create_media_download', { request });
        await fetchDownloads();
        closeAddDialog();
        return;
      } catch (e: any) {
        alert(`Error starting video download: ${e}`);
        return;
      }
    }

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

  const formatDuration = (seconds?: number | null) => {
    if (!seconds) return '';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  if (!isAddDialogOpen) return null;

  return (
    <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 select-none">
      <div className="w-full max-w-xl bg-card border border-border rounded-xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="p-4 border-b border-border flex items-center justify-between bg-card/90">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-md bg-primary/20 text-primary flex items-center justify-center">
              {isMediaUrl ? <Film className="w-4 h-4" /> : <Download className="w-4 h-4" />}
            </div>
            <h3 className="font-semibold text-sm text-foreground">
              {isMediaUrl ? 'Add Video / Media Download' : 'Add New Download'}
            </h3>
          </div>
          <button
            onClick={closeAddDialog}
            className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary transition cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4 text-xs max-h-[75vh] overflow-y-auto">
          {/* URL Input */}
          <div className="space-y-1.5">
            <label className="font-medium text-foreground">Download URL</label>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="Paste direct download link or YouTube/video URL..."
                value={url}
                onChange={(e) => {
                  setUrl(e.target.value);
                  if (e.target.value.length > 8) {
                    handleUrlChange(e.target.value);
                  }
                }}
                className="flex-1 px-3 py-2 rounded-md bg-secondary/60 border border-border focus:border-primary focus:bg-background outline-none transition font-mono text-xs text-foreground"
                autoFocus
              />
              <button
                type="button"
                onClick={() => handleUrlChange(url)}
                disabled={isProbing || isExtractingMedia || !url}
                className="px-3 py-2 rounded-md bg-secondary hover:bg-secondary/80 font-medium text-foreground transition flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                {isProbing || isExtractingMedia ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" />
                ) : (
                  <Sparkles className="w-3.5 h-3.5 text-primary" />
                )}
                <span>{isMediaUrl ? 'Extract' : 'Probe'}</span>
              </button>
            </div>
          </div>

          {/* Media Extraction Card (YouTube / Social Media) */}
          {isExtractingMedia && (
            <div className="p-4 rounded-lg bg-primary/5 border border-primary/20 flex items-center gap-3">
              <Loader2 className="w-5 h-5 animate-spin text-primary flex-shrink-0" />
              <div>
                <p className="font-medium text-foreground">Extracting video streams...</p>
                <p className="text-[11px] text-muted-foreground">Resolving resolutions, audio streams, and metadata via yt-dlp</p>
              </div>
            </div>
          )}

          {mediaInfo && (
            <div className="p-3.5 rounded-xl bg-secondary/30 border border-border/80 space-y-3">
              <div className="flex gap-3">
                {mediaInfo.thumbnail && (
                  <div className="relative w-28 h-18 rounded-lg overflow-hidden flex-shrink-0 bg-background border border-border">
                    <img
                      src={mediaInfo.thumbnail}
                      alt={mediaInfo.title}
                      className="w-full h-full object-cover"
                    />
                    {mediaInfo.duration && (
                      <span className="absolute bottom-1 right-1 px-1 py-0.5 rounded bg-black/80 text-[10px] text-white font-mono">
                        {formatDuration(mediaInfo.duration)}
                      </span>
                    )}
                  </div>
                )}
                <div className="flex-1 min-w-0 space-y-1">
                  <div className="flex items-center gap-1.5">
                    <span className="px-1.5 py-0.5 rounded bg-primary/10 text-primary font-semibold text-[10px] uppercase tracking-wider">
                      {mediaInfo.extractor}
                    </span>
                    {mediaInfo.uploader && (
                      <span className="text-[11px] text-muted-foreground truncate">
                        by {mediaInfo.uploader}
                      </span>
                    )}
                  </div>
                  <h4 className="font-semibold text-xs text-foreground line-clamp-2 leading-snug">
                    {mediaInfo.title}
                  </h4>
                </div>
              </div>

              {/* Quality & Mode Picker */}
              <div className="grid grid-cols-2 gap-2 pt-2 border-t border-border/50">
                {(() => {
                  const audioFmts = mediaInfo.formats.filter((f) => f.has_audio && !f.has_video);
                  const bestAud = audioFmts.sort((a, b) => (b.filesize || b.filesize_approx || 0) - (a.filesize || a.filesize_approx || 0))[0];
                  const audioSize = bestAud?.filesize || bestAud?.filesize_approx;

                  return (
                    <div className="space-y-1">
                      <label className="text-[11px] font-medium text-muted-foreground">Download Mode</label>
                      <div className="flex gap-1.5">
                        <button
                          type="button"
                          onClick={() => {
                            setIsAudioOnly(false);
                            setCategory('Videos');
                          }}
                          className={`flex-1 py-1.5 px-2 rounded-md font-medium text-xs flex items-center justify-center gap-1 transition ${
                            !isAudioOnly
                              ? 'bg-primary text-primary-foreground shadow-sm'
                              : 'bg-secondary text-muted-foreground hover:text-foreground'
                          }`}
                        >
                          <Video className="w-3.5 h-3.5" />
                          <span>Video (MP4)</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setIsAudioOnly(true);
                            setCategory('Music');
                          }}
                          className={`flex-1 py-1.5 px-2 rounded-md font-medium text-xs flex items-center justify-center gap-1 transition ${
                            isAudioOnly
                              ? 'bg-primary text-primary-foreground shadow-sm'
                              : 'bg-secondary text-muted-foreground hover:text-foreground'
                          }`}
                        >
                          <Music className="w-3.5 h-3.5" />
                          <span>Audio {audioSize ? `(${formatBytes(audioSize)})` : '(MP3)'}</span>
                        </button>
                      </div>
                    </div>
                  );
                })()}

                {!isAudioOnly && (
                  <div className="space-y-1">
                    <label className="text-[11px] font-medium text-muted-foreground">Resolution / Quality</label>
                    <select
                      value={selectedFormatId}
                      onChange={(e) => setSelectedFormatId(e.target.value)}
                      className="w-full px-2.5 py-1.5 rounded-md bg-secondary/80 border border-border focus:border-primary outline-none transition text-xs text-foreground cursor-pointer"
                    >
                      {(() => {
                        const bestVid = mediaInfo.formats
                          .filter((f) => f.has_video)
                          .sort((a, b) => (b.filesize || b.filesize_approx || 0) - (a.filesize || a.filesize_approx || 0))[0];
                        const bestVidSize = bestVid?.filesize || bestVid?.filesize_approx;
                        const bestLabel = bestVidSize
                          ? `Best Available Quality • ${formatBytes(bestVidSize)}`
                          : 'Best Quality Available (Auto Mux)';
                        return <option value="best">{bestLabel}</option>;
                      })()}
                      {(() => {
                        const getNumericHeight = (f: MediaFormat): number => {
                          if (!f.resolution) return 0;
                          if (f.resolution.includes('x')) {
                            const parts = f.resolution.split('x');
                            return parseInt(parts[1], 10) || 0;
                          }
                          return parseInt(f.resolution.replace(/[^0-9]/g, ''), 10) || 0;
                        };

                        const formatQualityLabel = (f: MediaFormat): string => {
                          let heightStr = f.resolution || '';
                          if (heightStr.includes('x')) {
                            const parts = heightStr.split('x');
                            heightStr = parts[1] || parts[0];
                          }
                          const cleanHeight = heightStr.replace(/[^0-9]/g, '');
                          const resLabel = cleanHeight ? `${cleanHeight}p` : f.resolution || 'Video';
                          const fpsLabel = f.fps ? ` @ ${Math.round(f.fps)}fps` : '';
                          const extLabel = f.ext ? ` (${f.ext})` : '';
                          const sizeVal = f.filesize || f.filesize_approx;
                          const sizeLabel = sizeVal ? ` • ${formatBytes(sizeVal)}` : '';
                          return `${resLabel}${fpsLabel}${extLabel}${sizeLabel}`;
                        };

                        return mediaInfo.formats
                          .filter((f) => f.has_video && f.resolution)
                          .sort((a, b) => getNumericHeight(b) - getNumericHeight(a))
                          .filter((f, idx, arr) => {
                            const h = getNumericHeight(f);
                            return arr.findIndex((x) => getNumericHeight(x) === h) === idx;
                          })
                          .map((f) => (
                            <option key={f.format_id} value={f.format_id}>
                              {formatQualityLabel(f)}
                            </option>
                          ));
                      })()}
                    </select>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Standard Probe Info Box */}
          {probeResult && !isMediaUrl && (
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
            <div className="p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-500 text-[11px] flex items-center gap-1.5">
              <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
              <span>{probeError}</span>
            </div>
          )}

          {/* File Name */}
          <div className="space-y-1.5">
            <label className="font-medium text-foreground">File Name / Title</label>
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

            {!isMediaUrl && (
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
            )}
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
            {!isMediaUrl && (
              <button
                type="button"
                onClick={() => handleSubmit(false)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-secondary hover:bg-secondary/80 text-foreground text-xs font-semibold transition cursor-pointer"
              >
                <Clock className="w-3.5 h-3.5" />
                <span>Queue</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => handleSubmit(true)}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-md bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-semibold shadow-md shadow-primary/30 transition active:scale-95 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>{isMediaUrl ? (isAudioOnly ? 'Download MP3' : 'Download Video') : 'Start Download'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
