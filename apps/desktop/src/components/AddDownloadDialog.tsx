import React, { useState, useEffect, useRef } from 'react';
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
  FolderOpen,
} from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { useDownloadStore } from '../stores/downloadStore';
import { useUIStore, AddDialogSession } from '../stores/uiStore';
import { useSettingsStore } from '../stores/settingsStore';
import { formatBytes } from '../lib/utils';
import { UrlProbeResult, MediaInfo, MediaFormat, MediaDownloadRequest } from '../types';
import { readText } from '@tauri-apps/plugin-clipboard-manager';

export interface AddDownloadDialogProps {
  session?: AddDialogSession;
  index?: number;
  totalCount?: number;
  onClose?: () => void;
}

export const AddDownloadDialog: React.FC<AddDownloadDialogProps> = ({
  session,
  index = 0,
  totalCount = 1,
  onClose,
}) => {
  const { addDialogSessions, isAddDialogOpen, closeAddDialog, bringDialogToFront } = useUIStore();
  const { addDownload, probeUrl, fetchDownloads } = useDownloadStore();
  const { settings } = useSettingsStore();

  // If no session passed directly, pick from store
  const effectiveSession: AddDialogSession | undefined = session || addDialogSessions[0];
  const effectiveIndex = index;
  const effectiveTotal = session ? totalCount : addDialogSessions.length;

  const effectiveOnClose = () => {
    if (onClose) {
      onClose();
    } else if (effectiveSession) {
      closeAddDialog(effectiveSession.id);
    } else {
      closeAddDialog();
    }
  };

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

  // Dragging / Window Position State (like IDM multi-window)
  const [position, setPosition] = useState({
    x: (effectiveIndex % 8) * 30,
    y: (effectiveIndex % 8) * 30,
  });
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef({ mouseX: 0, mouseY: 0, posX: 0, posY: 0 });

  const handleHeaderMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest('button, input, select, a, textarea')) return;
    if (effectiveSession) {
      bringDialogToFront(effectiveSession.id);
    }
    setIsDragging(true);
    dragStartRef.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      posX: position.x,
      posY: position.y,
    };
  };

  useEffect(() => {
    if (!isDragging) return;
    const handleMouseMove = (e: MouseEvent) => {
      const dx = e.clientX - dragStartRef.current.mouseX;
      const dy = e.clientY - dragStartRef.current.mouseY;
      setPosition({
        x: dragStartRef.current.posX + dx,
        y: dragStartRef.current.posY + dy,
      });
    };
    const handleMouseUp = () => {
      setIsDragging(false);
    };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging]);

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
      u.includes('dai.ly') ||
      u.includes('twitch.tv') ||
      u.includes('soundcloud.com') ||
      u.includes('bilibili.com') ||
      u.includes('pinterest.com') ||
      u.includes('.m3u8') ||
      u.includes('.mpd')
    );
  };

  useEffect(() => {
    if (!effectiveSession && !isAddDialogOpen) return;

    const prefilledMediaOptions = effectiveSession?.mediaOptions;
    const prefilledUrl = effectiveSession?.url || '';

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
      } else {
        setFileName('');
      }
    } else {
      setFileName('');
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
  }, [effectiveSession?.id]);

  const handleUrlChange = (targetUrl: string) => {
    const trimmed = targetUrl.trim();
    if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
      return;
    }

    if (checkIfMediaUrl(trimmed)) {
      setIsMediaUrl(true);
      setProbeResult(null);
      setMediaInfo(null);
      handleExtractMedia(trimmed);
    } else {
      setIsMediaUrl(false);
      setMediaInfo(null);
      setProbeResult(null);
      handleProbe(trimmed);
    }
  };

  const getNumericHeight = (f: MediaFormat): number => {
    if (!f.resolution) return 0;
    if (f.resolution.includes('x')) {
      const parts = f.resolution.split('x');
      return parseInt(parts[1], 10) || 0;
    }
    return parseInt(f.resolution.replace(/[^0-9]/g, ''), 10) || 0;
  };

  const sortVideoFormats = (a: MediaFormat, b: MediaFormat): number => {
    const hDiff = getNumericHeight(b) - getNumericHeight(a);
    if (hDiff !== 0) return hDiff;
    // Prefer MP4 container
    const aMp4 = a.ext === 'mp4' ? 0 : 1;
    const bMp4 = b.ext === 'mp4' ? 0 : 1;
    if (aMp4 !== bMp4) return aMp4 - bMp4;
    // Prefer known filesize
    const aHasSize = a.filesize ? 0 : 1;
    const bHasSize = b.filesize ? 0 : 1;
    if (aHasSize !== bHasSize) return aHasSize - bHasSize;
    return (a.filesize || a.filesize_approx || 0) - (b.filesize || b.filesize_approx || 0);
  };

  const resolveMatchingFormatId = (desired: string | undefined, formats: MediaFormat[]): string => {
    if (!desired || desired === 'best') return 'best';
    if (formats.some((f) => f.format_id === desired)) {
      return desired;
    }
    const targetHeight = parseInt(desired.replace(/[^0-9]/g, ''), 10);
    if (targetHeight > 0) {
      const matched = formats
        .filter((f) => f.has_video && getNumericHeight(f) === targetHeight)
        .sort(sortVideoFormats)[0];

      if (matched) {
        return matched.format_id;
      }
    }
    return desired;
  };

  const handleExtractMedia = async (targetUrl: string) => {
    setIsExtractingMedia(true);
    setProbeError(null);
    try {
      const info = await invoke<MediaInfo>('extract_media_info', { url: targetUrl });
      setMediaInfo(info);
      if (info && info.title) {
        setFileName(info.title);
      }
      const prefilledMediaOptions = effectiveSession?.mediaOptions;
      if (prefilledMediaOptions?.isAudioOnly || prefilledMediaOptions?.formatId === 'audio') {
        setIsAudioOnly(true);
        setCategory('Music');
      } else {
        setCategory('Videos');
        if (prefilledMediaOptions?.formatId) {
          const matched = resolveMatchingFormatId(prefilledMediaOptions.formatId, info.formats);
          setSelectedFormatId(matched);
        }
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
      const prefilledMediaOptions = effectiveSession?.mediaOptions;

      if (isAudioOnly) {
        const audioFmts = mediaInfo?.formats.filter((f) => f.has_audio && !f.has_video);
        const bestAud = audioFmts?.sort((a, b) => (b.filesize || b.filesize_approx || 0) - (a.filesize || a.filesize_approx || 0))[0];
        calculatedSize = bestAud?.filesize || bestAud?.filesize_approx || prefilledMediaOptions?.fileSize || undefined;
      } else if (selectedFormatId === 'best') {
        const bestVid = mediaInfo?.formats
          .filter((f) => f.has_video)
          .sort(sortVideoFormats)[0];
        calculatedSize = bestVid?.filesize || bestVid?.filesize_approx || prefilledMediaOptions?.fileSize || undefined;
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
      effectiveOnClose();
    } catch (e: any) {
      alert(`Error starting video download: ${e}`);
    }
  };

  const handleSubmit = async (startNow: boolean) => {
    if (!url.trim()) return;
    const prefilledMediaOptions = effectiveSession?.mediaOptions;

    if (isMediaUrl) {
      if (mediaInfo) {
        await handleMediaDownloadSubmit();
        return;
      }
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
        effectiveOnClose();
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
      effectiveOnClose();
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

  const handleBrowseDirectory = async () => {
    try {
      const selected = await openDialog({
        directory: true,
        multiple: false,
        defaultPath: directory || undefined,
      });
      if (selected && typeof selected === 'string') {
        setDirectory(selected);
      }
    } catch (e) {
      console.error('Failed to open directory picker', e);
    }
  };

  if (!effectiveSession && !isAddDialogOpen) return null;

  return (
    <>
      {effectiveIndex === 0 && (
        <div
          onClick={effectiveOnClose}
          className="fixed inset-0 bg-background/60 backdrop-blur-xs z-40"
        />
      )}
      <div
        className="fixed inset-0 pointer-events-none flex items-center justify-center p-4 select-none"
        style={{ zIndex: 50 + effectiveIndex }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && url.trim()) {
            e.preventDefault();
            handleSubmit(true);
          } else if (e.key === 'Escape') {
            e.preventDefault();
            effectiveOnClose();
          }
        }}
      >
        <div
          onClick={() => effectiveSession && bringDialogToFront(effectiveSession.id)}
          style={{
            transform: `translate(${position.x}px, ${position.y}px)`,
          }}
          className="pointer-events-auto w-full max-w-xl bg-card border border-border/80 rounded-xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150"
        >
          {/* Header (Draggable) */}
          <div
            onMouseDown={handleHeaderMouseDown}
            className="p-4 border-b border-border flex items-center justify-between bg-card/95 cursor-move active:cursor-grabbing select-none"
          >
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-md bg-primary/20 text-primary flex items-center justify-center pointer-events-none">
                {isMediaUrl ? <Film className="w-4 h-4" /> : <Download className="w-4 h-4" />}
              </div>
              <h3 className="font-semibold text-sm text-foreground pointer-events-none">
                {isMediaUrl ? 'Add Video / Media Download' : 'Add New Download'}
              </h3>
              {effectiveTotal > 1 && (
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium border border-primary/20 pointer-events-none">
                  #{effectiveIndex + 1} of {effectiveTotal}
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={effectiveOnClose}
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
                {isProbing || isExtractingMedia ? (
                  <div className="flex items-center gap-1.5 px-3 py-2 rounded-md bg-secondary text-muted-foreground">
                    <Loader2 className="w-4 h-4 animate-spin text-primary" />
                    <span>Analyzing...</span>
                  </div>
                ) : null}
              </div>
              {probeError && (
                <div className="flex flex-col gap-1.5 p-2.5 rounded bg-amber-500/10 border border-amber-500/20 text-amber-500 text-[11px] mt-1">
                  <div className="flex items-start gap-1.5">
                    <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                    <span className="flex-1 break-all leading-relaxed">{probeError}</span>
                  </div>
                  <div className="flex gap-2 mt-1">
                    <button
                      type="button"
                      onClick={() => {
                        setIsMediaUrl(false);
                        setMediaInfo(null);
                        setProbeError(null);
                        handleProbe(url);
                      }}
                      className="px-2.5 py-1 rounded bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 font-medium text-[11px] transition"
                    >
                      Switch to Direct Download
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        handleExtractMedia(url);
                      }}
                      className="px-2.5 py-1 rounded bg-secondary hover:bg-secondary/80 text-foreground text-[11px] transition"
                    >
                      Retry Extraction
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Media Extractor Preview Panel */}
            {isMediaUrl && mediaInfo && (
              <div className="p-3 rounded-lg bg-primary/5 border border-primary/20 space-y-3">
                <div className="flex gap-3">
                  {mediaInfo.thumbnail && (
                    <div className="w-24 h-16 rounded overflow-hidden flex-shrink-0 bg-muted border border-border relative">
                      <img
                        src={mediaInfo.thumbnail}
                        alt="Thumbnail"
                        className="w-full h-full object-cover"
                        onError={(e) => ((e.target as HTMLElement).style.display = 'none')}
                      />
                      {mediaInfo.duration && (
                        <span className="absolute bottom-1 right-1 px-1 py-0.5 rounded bg-black/80 text-[9px] font-mono text-white">
                          {formatDuration(mediaInfo.duration)}
                        </span>
                      )}
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-foreground text-xs line-clamp-2 leading-relaxed">
                      {mediaInfo.title}
                    </div>
                    <div className="flex items-center gap-2 mt-1 text-[11px] text-muted-foreground">
                      {mediaInfo.uploader && <span>{mediaInfo.uploader}</span>}
                      {mediaInfo.extractor && (
                        <>
                          <span>•</span>
                          <span className="capitalize">{mediaInfo.extractor}</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                {/* Quality & Audio Toggles */}
                <div className="pt-2 border-t border-primary/10 flex flex-col gap-2">
                  {(() => {
                    const audioFmts = mediaInfo.formats.filter((f) => f.has_audio && !f.has_video);
                    const bestAud = audioFmts.sort(
                      (a, b) => (b.filesize || b.filesize_approx || 0) - (a.filesize || a.filesize_approx || 0)
                    )[0];
                    const audioSize = bestAud?.filesize || bestAud?.filesize_approx;

                    return (
                      <div>
                        <label className="text-[11px] font-medium text-muted-foreground block mb-1">Download Mode</label>
                        <div className="flex gap-2">
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
                            <span>Video + Audio</span>
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
                            .sort(sortVideoFormats)[0];
                          const bestVidSize = bestVid?.filesize || bestVid?.filesize_approx;
                          const bestLabel = bestVidSize
                            ? `Best Available Quality • ${formatBytes(bestVidSize)}`
                            : 'Best Quality Available (Auto Mux)';
                          return <option value="best">{bestLabel}</option>;
                        })()}
                        {(() => {
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
                            .sort(sortVideoFormats)
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

            {/* File Name */}
            <div className="space-y-1.5">
              <label className="font-medium text-foreground">Save File As</label>
              <input
                type="text"
                value={fileName}
                onChange={(e) => setFileName(e.target.value)}
                placeholder={isMediaUrl ? 'Video Title' : 'filename.ext'}
                className="w-full px-3 py-2 rounded-md bg-secondary/60 border border-border focus:border-primary focus:bg-background outline-none transition text-xs text-foreground font-mono"
              />
            </div>

            {/* Category & Connections */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="font-medium text-foreground">Category</label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="w-full px-3 py-2 rounded-md bg-secondary/60 border border-border focus:border-primary outline-none transition text-xs text-foreground cursor-pointer"
                >
                  <option value="General">General</option>
                  <option value="Videos">Videos</option>
                  <option value="Music">Music</option>
                  <option value="Documents">Documents</option>
                  <option value="Programs">Programs</option>
                  <option value="Archives">Archives</option>
                  <option value="Other">Other</option>
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="font-medium text-foreground">Max Segments</label>
                <select
                  value={connections}
                  onChange={(e) => setConnections(Number(e.target.value))}
                  disabled={probeResult ? !probeResult.accept_ranges : false}
                  className="w-full px-3 py-2 rounded-md bg-secondary/60 border border-border focus:border-primary outline-none transition text-xs text-foreground cursor-pointer disabled:opacity-50"
                >
                  <option value={1}>1 Connection (Single)</option>
                  <option value={2}>2 Connections</option>
                  <option value={4}>4 Connections (Standard)</option>
                  <option value={8}>8 Connections (Turbo)</option>
                  <option value={16}>16 Connections (Maximum)</option>
                </select>
              </div>
            </div>

            {/* Directory Selection with Browse Button */}
            <div className="space-y-1.5">
              <label className="font-medium text-foreground">Save Location</label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Folder className="absolute left-3 top-2.5 w-3.5 h-3.5 text-muted-foreground" />
                  <input
                    type="text"
                    value={directory}
                    onChange={(e) => setDirectory(e.target.value)}
                    placeholder="Download folder path..."
                    className="w-full pl-8 pr-3 py-2 rounded-md bg-secondary/60 border border-border focus:border-primary outline-none transition text-xs text-foreground font-mono"
                  />
                </div>
                <button
                  type="button"
                  onClick={handleBrowseDirectory}
                  className="px-3 py-2 rounded-md bg-secondary hover:bg-secondary/80 font-medium text-foreground transition flex items-center gap-1.5 cursor-pointer text-xs flex-shrink-0"
                  title="Browse save destination folder"
                >
                  <FolderOpen className="w-3.5 h-3.5 text-primary" />
                  <span>Browse...</span>
                </button>
              </div>
            </div>
          </div>

          {/* Footer Actions */}
          <div className="p-4 border-t border-border flex items-center justify-between bg-card/90">
            <button
              type="button"
              onClick={effectiveOnClose}
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
    </>
  );
};
