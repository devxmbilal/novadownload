// NovaDownload Browser Extension - Content Script
// Real-Time IDM-Style Video Quality Sniffer & Download Integration for All Websites

const BRIDGE_URL = 'http://127.0.0.1:64123';

export interface DetectedQuality {
  id: string;
  label: string;
  resolution: string;
  ext: string;
  fileSize?: number;
  isAudio?: boolean;
  isBest?: boolean;
}

interface CacheEntry {
  qualities: DetectedQuality[];
  title?: string;
  isFetching?: boolean;
}

const urlQualitiesCache = new Map<string, CacheEntry>();
let currentVideoTitle = '';
let lastFetchedUrl = '';

function formatBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let val = bytes;
  while (val >= 1024 && i < units.length - 1) {
    val /= 1024;
    i++;
  }
  return `${val.toFixed(val >= 10 ? 0 : 1)} ${units[i]}`;
}

function getYouTubeVideoTitle(): string {
  const domTitle =
    document.querySelector('h1.ytd-watch-metadata yt-formatted-string')?.textContent?.trim() ||
    document.querySelector('#title h1 yt-formatted-string')?.textContent?.trim() ||
    document.querySelector('h1.title yt-formatted-string')?.textContent?.trim() ||
    (document.querySelector('h1.ytd-video-primary-info-renderer') as HTMLElement)?.innerText?.trim() ||
    document.querySelector('meta[name="title"]')?.getAttribute('content')?.trim();

  if (domTitle) return domTitle;
  if (currentVideoTitle && currentVideoTitle.trim()) return currentVideoTitle.trim();

  const docTitle = document.title.replace(/ - YouTube$/, '').trim();
  if (docTitle && docTitle !== 'YouTube') return docTitle;

  return '';
}

// Listen for popup inspection messages
chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (request.action === 'get_media') {
    const media: { url: string; title: string; type?: string }[] = [];
    const addedUrls = new Set<string>();

    const addMedia = (url: string, title: string, type: string) => {
      if (!url || !url.startsWith('http')) return;
      if (addedUrls.has(url)) return;
      addedUrls.add(url);
      media.push({ url, title: title.trim() || 'Media Item', type });
    };

    const pageUrl = window.location.href;
    const isMediaSite =
      pageUrl.includes('youtube.com/watch') ||
      pageUrl.includes('youtube.com/shorts') ||
      pageUrl.includes('youtu.be') ||
      pageUrl.includes('facebook.com') ||
      pageUrl.includes('fb.watch') ||
      pageUrl.includes('instagram.com') ||
      pageUrl.includes('tiktok.com') ||
      pageUrl.includes('twitter.com') ||
      pageUrl.includes('x.com') ||
      pageUrl.includes('vimeo.com') ||
      pageUrl.includes('reddit.com') ||
      pageUrl.includes('dailymotion.com');

    if (isMediaSite) {
      addMedia(pageUrl, getYouTubeVideoTitle() || document.title || 'Web Video', 'Video');
    }

    document.querySelectorAll('video, audio, source').forEach((el) => {
      const src =
        (el as HTMLMediaElement).currentSrc ||
        (el as HTMLMediaElement).src ||
        (el as HTMLSourceElement).src;
      if (src && src.startsWith('http')) {
        const title =
          (el as HTMLMediaElement).title ||
          el.getAttribute('aria-label') ||
          getYouTubeVideoTitle() ||
          document.title ||
          'Media Stream';
        addMedia(src, title, el.tagName.toLowerCase() === 'audio' ? 'Audio' : 'Video');
      }
    });

    const downloadExts = /\.(zip|rar|7z|tar|gz|iso|exe|msi|apk|dmg|pdf|docx|xlsx|pptx|mp4|mkv|avi|mov|mp3|wav|flac|png|jpg|jpeg|webp)($|\?)/i;
    document.querySelectorAll('a[href]').forEach((a) => {
      const href = (a as HTMLAnchorElement).href;
      if (href && href.startsWith('http') && downloadExts.test(href)) {
        const title = a.textContent?.trim() || a.getAttribute('download') || href.split('/').pop() || 'File';
        addMedia(href, title, 'File');
      }
    });

    sendResponse({ media });
  }
});

// Helper to parse yt-dlp / bridge media formats into clean DetectedQuality list
function parseExtractorFormats(info: any): DetectedQuality[] {
  if (!info || !info.formats || !Array.isArray(info.formats)) {
    return [];
  }

  const formats: any[] = info.formats;
  const list: DetectedQuality[] = [];

  // Find best audio size to add to adaptive video sizes
  const audioFmts = formats.filter((f) => f.has_audio && !f.has_video);
  const bestAudio = audioFmts.sort(
    (a, b) => (b.filesize || b.filesize_approx || 0) - (a.filesize || a.filesize_approx || 0)
  )[0];
  const audioBytes = bestAudio ? bestAudio.filesize || bestAudio.filesize_approx || 0 : 0;

  // Track resolutions we've already added to avoid duplicate rows
  const seenResolutions = new Set<string>();

  // Extract height helper
  const getHeight = (f: any): number => {
    if (f.height) return f.height;
    if (f.resolution) {
      if (f.resolution.includes('x')) {
        return parseInt(f.resolution.split('x')[1], 10) || 0;
      }
      return parseInt(f.resolution.replace(/[^0-9]/g, ''), 10) || 0;
    }
    return 0;
  };

  // 1. Sort video formats from highest to lowest quality
  const videoFmts = formats
    .filter((f) => f.has_video)
    .sort((a, b) => {
      const hDiff = getHeight(b) - getHeight(a);
      if (hDiff !== 0) return hDiff;
      const aMp4 = a.ext === 'mp4' ? 0 : 1;
      const bMp4 = b.ext === 'mp4' ? 0 : 1;
      if (aMp4 !== bMp4) return aMp4 - bMp4;
      return (b.filesize || b.filesize_approx || 0) - (a.filesize || a.filesize_approx || 0);
    });

  for (const f of videoFmts) {
    const h = getHeight(f);
    if (!h || h < 144) continue;

    let resKey = `${h}p`;
    if (h >= 2160) resKey = '4K UHD (2160p)';
    else if (h >= 1440) resKey = '2K QHD (1440p)';
    else if (h >= 1080) resKey = '1080p Full HD';
    else if (h >= 720) resKey = '720p HD';
    else if (h >= 480) resKey = '480p SD';
    else if (h >= 360) resKey = '360p Medium';
    else resKey = `${h}p`;

    if (seenResolutions.has(resKey)) continue;
    seenResolutions.add(resKey);

    let totalSize = f.filesize || f.filesize_approx || 0;
    // If format is video-only adaptive, add audio size
    if (f.has_video && !f.has_audio && audioBytes > 0) {
      totalSize += audioBytes;
    }

    list.push({
      id: f.format_id || `${h}p`,
      label: resKey,
      resolution: `${h}p`,
      ext: f.ext || 'mp4',
      fileSize: totalSize > 0 ? totalSize : undefined,
      isAudio: false,
    });
  }

  // 2. Add Best Quality (Auto) at top if not empty
  if (list.length > 0) {
    list.unshift({
      id: 'best',
      label: 'Auto (Best Available)',
      resolution: 'Best',
      ext: list[0]?.ext || 'mp4',
      fileSize: list[0]?.fileSize,
      isAudio: false,
      isBest: true,
    });
  }

  // 3. Add Best Audio Only (MP3/M4A)
  if (bestAudio) {
    const sz = bestAudio.filesize || bestAudio.filesize_approx || 0;
    list.push({
      id: bestAudio.format_id || 'audio',
      label: 'Audio Only (MP3 / M4A)',
      resolution: 'MP3',
      ext: 'mp3',
      fileSize: sz > 0 ? sz : undefined,
      isAudio: true,
    });
  } else {
    list.push({
      id: 'audio',
      label: 'Audio Only (MP3)',
      resolution: 'MP3',
      ext: 'mp3',
      isAudio: true,
    });
  }

  return list;
}

// Build fallback qualities based on HTML5 video element properties
function buildFallbackQualities(videoEl?: HTMLVideoElement): DetectedQuality[] {
  const list: DetectedQuality[] = [];
  let detectedRes = '';

  if (videoEl && videoEl.videoWidth && videoEl.videoHeight) {
    const h = videoEl.videoHeight;
    detectedRes = h >= 1080 ? '1080p' : h >= 720 ? '720p' : h >= 480 ? '480p' : '360p';
  }

  list.push({
    id: 'best',
    label: detectedRes ? `Download Video (${detectedRes})` : 'Download Video (Auto)',
    resolution: detectedRes || 'Best',
    ext: 'mp4',
    isAudio: false,
    isBest: true,
  });

  list.push({
    id: '1080p',
    label: '1080p Full HD',
    resolution: '1080p',
    ext: 'mp4',
    isAudio: false,
  });

  list.push({
    id: '720p',
    label: '720p HD',
    resolution: '720p',
    ext: 'mp4',
    isAudio: false,
  });

  list.push({
    id: '480p',
    label: '480p SD',
    resolution: '480p',
    ext: 'mp4',
    isAudio: false,
  });

  list.push({
    id: 'audio',
    label: 'Audio Only (MP3)',
    resolution: 'MP3',
    ext: 'mp3',
    isAudio: true,
  });

  return list;
}

// Fetch qualities from desktop bridge for any URL
async function fetchQualitiesForUrl(url: string, videoEl?: HTMLVideoElement, onUpdated?: (qualities: DetectedQuality[]) => void): Promise<DetectedQuality[]> {
  if (!url || !url.startsWith('http')) {
    return buildFallbackQualities(videoEl);
  }

  const cached = urlQualitiesCache.get(url);
  if (cached && cached.qualities && cached.qualities.length > 0 && !cached.isFetching) {
    return cached.qualities;
  }

  if (cached?.isFetching) {
    return buildFallbackQualities(videoEl);
  }

  urlQualitiesCache.set(url, {
    qualities: buildFallbackQualities(videoEl),
    isFetching: true,
  });

  try {
    const res = await fetch(`${BRIDGE_URL}/api/v1/media-info?url=${encodeURIComponent(url)}`);
    if (res.ok) {
      const data = await res.json();
      if (data.success && data.info) {
        const qualities = parseExtractorFormats(data.info);
        if (qualities.length > 0) {
          urlQualitiesCache.set(url, {
            qualities,
            title: data.info.title,
            isFetching: false,
          });
          if (onUpdated) onUpdated(qualities);
          return qualities;
        }
      }
    }
  } catch {}

  const fallback = buildFallbackQualities(videoEl);
  urlQualitiesCache.set(url, {
    qualities: fallback,
    isFetching: false,
  });
  return fallback;
}

// Listen for page script bridge messages containing ytInitialPlayerResponse
if (typeof window !== 'undefined') {
  window.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'NOVADOWNLOAD_YT_PLAYER_RESPONSE') {
      if (event.data.response) {
        parsePlayerResponse(event.data.response);
      }
    }
  });
}

function requestPagePlayerResponse() {
  try {
    const script = document.createElement('script');
    script.textContent = `
      (function() {
        try {
          var resp = window.ytInitialPlayerResponse || 
            (window.ytplayer && window.ytplayer.config && window.ytplayer.config.args && JSON.parse(window.ytplayer.config.args.raw_player_response));
          if (resp) {
            window.postMessage({ type: 'NOVADOWNLOAD_YT_PLAYER_RESPONSE', response: resp }, '*');
          }
        } catch(e) {}
      })();
    `;
    (document.head || document.documentElement).appendChild(script);
    script.remove();
  } catch {}
}

function parsePlayerResponse(resp: any) {
  if (!resp) return;
  const details = resp.videoDetails;
  if (details?.title) {
    currentVideoTitle = details.title;
  }
  const durationSec = details?.lengthSeconds ? parseInt(details.lengthSeconds, 10) : 0;
  const streamingData = resp.streamingData;
  if (!streamingData) return;

  const adaptiveFormats: any[] = streamingData.adaptiveFormats || [];
  const regularFormats: any[] = streamingData.formats || [];

  const getStreamBytes = (fmt: any): number => {
    if (fmt?.contentLength) return parseInt(fmt.contentLength, 10);
    if (fmt?.bitrate && durationSec > 0) return Math.round((fmt.bitrate * durationSec) / 8);
    return 0;
  };

  const audioStreams = adaptiveFormats.filter((f) => f.mimeType && f.mimeType.startsWith('audio/'));
  const bestAudio =
    audioStreams.find((f) => f.itag === 140) ||
    audioStreams.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0];

  const audioBytes = bestAudio ? getStreamBytes(bestAudio) : 0;
  const list: DetectedQuality[] = [];
  const seenHeights = new Set<number>();

  // Process all available adaptive streams
  const sortedAdaptive = adaptiveFormats
    .filter((f) => f.mimeType && f.mimeType.startsWith('video/'))
    .sort((a, b) => (b.height || 0) - (a.height || 0));

  for (const f of sortedAdaptive) {
    const h = f.height || (f.qualityLabel ? parseInt(f.qualityLabel, 10) : 0);
    if (!h || seenHeights.has(h)) continue;
    seenHeights.add(h);

    const vBytes = getStreamBytes(f);
    const totalBytes = vBytes > 0 ? vBytes + audioBytes : undefined;
    let label = `${h}p`;
    if (h >= 2160) label = '4K UHD (2160p)';
    else if (h >= 1440) label = '2K QHD (1440p)';
    else if (h >= 1080) label = '1080p Full HD';
    else if (h >= 720) label = '720p HD';
    else if (h >= 480) label = '480p SD';
    else if (h >= 360) label = '360p Medium';

    list.push({
      id: f.itag ? String(f.itag) : `${h}p`,
      label,
      resolution: `${h}p`,
      ext: f.mimeType?.includes('webm') ? 'webm' : 'mp4',
      fileSize: totalBytes,
      isAudio: false,
    });
  }

  // If no adaptive, check regular formats
  if (list.length === 0) {
    for (const f of regularFormats) {
      const h = f.height || 360;
      if (seenHeights.has(h)) continue;
      seenHeights.add(h);
      list.push({
        id: f.itag ? String(f.itag) : `${h}p`,
        label: `${h}p`,
        resolution: `${h}p`,
        ext: 'mp4',
        fileSize: getStreamBytes(f) || undefined,
        isAudio: false,
      });
    }
  }

  if (list.length > 0) {
    list.unshift({
      id: 'best',
      label: 'Auto (Best Quality)',
      resolution: list[0].resolution || 'Best',
      ext: list[0].ext || 'mp4',
      fileSize: list[0].fileSize,
      isAudio: false,
      isBest: true,
    });
  }

  if (audioBytes > 0) {
    list.push({
      id: '140',
      label: 'Audio Only (MP3 / M4A)',
      resolution: 'MP3',
      ext: 'mp3',
      fileSize: audioBytes,
      isAudio: true,
    });
  }

  if (list.length > 0) {
    urlQualitiesCache.set(window.location.href, {
      qualities: list,
      title: currentVideoTitle,
      isFetching: false,
    });
    renderYouTubeWidgetDropdown(list);
  }
}

async function triggerDownload(formatId: string = 'best', isAudio: boolean = false, fileSize?: number) {
  const currentUrl = window.location.href;
  const statusEl = document.getElementById('nd-yt-status-text');
  if (statusEl) statusEl.innerText = 'Sending...';

  const videoTitle = getYouTubeVideoTitle();

  try {
    const response = await fetch(`${BRIDGE_URL}/api/v1/download`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: currentUrl,
        format_id: formatId,
        is_audio_only: isAudio,
        file_size: fileSize,
        title: videoTitle || undefined,
        referrer: document.referrer,
      }),
    });

    if (response.ok) {
      if (statusEl) statusEl.innerText = '✓ Sent!';
      setTimeout(() => {
        if (statusEl) statusEl.innerText = 'NovaDownload';
      }, 2500);
    } else {
      throw new Error();
    }
  } catch {
    if (statusEl) statusEl.innerText = '⚠️ Desktop Offline';
    setTimeout(() => {
      if (statusEl) statusEl.innerText = 'NovaDownload';
    }, 2500);
  }
}

function renderYouTubeWidgetDropdown(qualities: DetectedQuality[]) {
  const dropdownMenu = document.querySelector('#novadownload-yt-player-widget .nd-dropdown-menu');
  if (!dropdownMenu) return;

  dropdownMenu.innerHTML = `
    <div style="padding: 4px 8px 6px; font-size: 10.5px; color: #94a3b8; font-weight: 600; border-bottom: 1px solid rgba(255,255,255,0.1); margin-bottom: 4px; display: flex; justify-content: space-between; align-items: center;">
      <span>Detected Qualities</span>
      <span style="background: rgba(14, 165, 233, 0.2); color: #38bdf8; padding: 1px 5px; border-radius: 3px; font-size: 9.5px;">${qualities.length} Available</span>
    </div>
  `;

  for (const q of qualities) {
    const item = document.createElement('div');
    item.className = 'nd-menu-item';
    item.setAttribute('data-format', q.id);
    item.setAttribute('data-audio', String(!!q.isAudio));
    if (q.fileSize) item.setAttribute('data-filesize', String(q.fileSize));

    const sizeStr = formatBytes(q.fileSize);
    const badgeClass = q.isAudio ? 'audio' : q.isBest ? 'hd' : q.resolution.includes('1080') || q.resolution.includes('4K') || q.resolution.includes('2K') ? 'hd' : '';

    item.innerHTML = `
      <div style="display: flex; align-items: center; gap: 6px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
        <span>${q.isAudio ? '🎵' : '🎬'}</span>
        <span>${q.label}</span>
      </div>
      <div style="display: flex; align-items: center; gap: 5px; flex-shrink: 0;">
        ${sizeStr ? `<span style="font-size: 9.5px; color: #94a3b8; font-weight: 600;">${sizeStr}</span>` : ''}
        <span class="nd-badge ${badgeClass}">${q.resolution}</span>
      </div>
    `;

    item.addEventListener('click', (e) => {
      e.stopPropagation();
      dropdownMenu.classList.remove('active');
      triggerDownload(q.id, !!q.isAudio, q.fileSize);
    });

    dropdownMenu.appendChild(item);
  }
}

let lastActiveUrl = '';

function checkUrlChange() {
  const currentHref = window.location.href;
  if (lastActiveUrl && lastActiveUrl !== currentHref) {
    currentVideoTitle = '';
    lastFetchedUrl = '';
  }
  lastActiveUrl = currentHref;
}

function injectYouTubePlayerWidget() {
  if (!window.location.hostname.includes('youtube.com')) return;
  checkUrlChange();
  const isVideoPage =
    window.location.pathname.startsWith('/watch') || window.location.pathname.startsWith('/shorts');

  const existingWidget = document.getElementById('novadownload-yt-player-widget');

  if (!isVideoPage) {
    if (existingWidget) existingWidget.remove();
    return;
  }

  const playerContainer =
    document.querySelector('#movie_player') ||
    document.querySelector('ytd-player') ||
    document.querySelector('#player-container') ||
    document.body;

  if (!playerContainer) return;

  if (existingWidget) {
    if (!playerContainer.contains(existingWidget) && playerContainer !== document.body) {
      playerContainer.appendChild(existingWidget);
    }
    requestPagePlayerResponse();
    fetchQualitiesForUrl(window.location.href, undefined, (qualities) => {
      renderYouTubeWidgetDropdown(qualities);
    });
    return;
  }

  const widget = document.createElement('div');
  widget.id = 'novadownload-yt-player-widget';
  widget.style.cssText = `
    position: absolute;
    top: 14px;
    right: 18px;
    z-index: 9999999;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    user-select: none;
  `;

  if (!document.getElementById('novadownload-widget-styles')) {
    const styleTag = document.createElement('style');
    styleTag.id = 'novadownload-widget-styles';
    styleTag.textContent = `
      #novadownload-yt-player-widget {
        opacity: 0.95;
        transition: opacity 0.2s, transform 0.2s;
      }
      #novadownload-yt-player-widget:hover {
        opacity: 1;
        transform: translateY(-1px);
      }
      .nd-main-btn {
        display: flex;
        align-items: center;
        gap: 8px;
        background: linear-gradient(135deg, #0284c7 0%, #0369a1 100%);
        color: #ffffff;
        padding: 7px 14px;
        border-radius: 8px;
        box-shadow: 0 4px 14px rgba(0, 0, 0, 0.5), 0 0 12px rgba(2, 132, 199, 0.4);
        cursor: pointer;
        font-size: 12.5px;
        font-weight: 600;
        border: 1px solid rgba(255, 255, 255, 0.35);
        backdrop-filter: blur(8px);
        transition: background 0.2s, box-shadow 0.2s;
      }
      .nd-main-btn:hover {
        background: linear-gradient(135deg, #0ea5e9 0%, #0284c7 100%);
        box-shadow: 0 6px 18px rgba(0, 0, 0, 0.55), 0 0 16px rgba(14, 165, 233, 0.55);
      }
      .nd-dropdown-menu {
        display: none;
        position: absolute;
        top: 100%;
        right: 0;
        margin-top: 6px;
        width: 260px;
        max-height: 320px;
        overflow-y: auto;
        background: #0f172a;
        border: 1px solid rgba(255, 255, 255, 0.18);
        border-radius: 10px;
        box-shadow: 0 12px 30px rgba(0, 0, 0, 0.7);
        padding: 6px;
        flex-direction: column;
        gap: 2px;
        backdrop-filter: blur(14px);
        z-index: 10000000;
      }
      #novadownload-yt-player-widget:hover .nd-dropdown-menu,
      .nd-dropdown-menu.active {
        display: flex !important;
      }
      .nd-menu-item {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 7px 10px;
        border-radius: 6px;
        color: #e2e8f0;
        font-size: 11.5px;
        font-weight: 500;
        cursor: pointer;
        transition: background 0.15s, color 0.15s;
      }
      .nd-menu-item:hover {
        background: rgba(14, 165, 233, 0.25);
        color: #38bdf8;
      }
      .nd-badge {
        font-size: 9.5px;
        padding: 2px 6px;
        border-radius: 4px;
        font-weight: 700;
        background: rgba(255, 255, 255, 0.1);
        color: #94a3b8;
        flex-shrink: 0;
      }
      .nd-badge.hd {
        background: rgba(14, 165, 233, 0.3);
        color: #38bdf8;
      }
      .nd-badge.audio {
        background: rgba(236, 72, 153, 0.25);
        color: #f472b6;
      }
    `;
    document.head.appendChild(styleTag);
  }

  widget.innerHTML = `
    <div class="nd-main-btn" id="nd-primary-btn" title="Click to choose format & download with NovaDownload">
      <img
        id="nd-btn-icon"
        src="${chrome.runtime.getURL('icons/48.png')}"
        width="18"
        height="18"
        style="border-radius: 4px; display: block; object-fit: contain; flex-shrink: 0;"
        alt="Nova"
      />
      <svg
        id="nd-fallback-icon"
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2.5"
        stroke-linecap="round"
        stroke-linejoin="round"
        style="display: none; flex-shrink: 0; color: #fff;"
      >
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
        <polyline points="7 10 12 15 17 10"></polyline>
        <line x1="12" y1="15" x2="12" y2="3"></line>
      </svg>
      <span id="nd-yt-status-text">NovaDownload</span>
      <svg id="nd-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="transition: transform 0.2s; flex-shrink: 0;">
        <polyline points="6 9 12 15 18 9"></polyline>
      </svg>
    </div>

    <div class="nd-dropdown-menu">
      <div style="padding: 10px; text-align: center; color: #94a3b8; font-size: 11px;">
        <span>🔍 Detecting qualities...</span>
      </div>
    </div>
  `;

  const primaryBtn = widget.querySelector('#nd-primary-btn');
  const dropdownMenu = widget.querySelector('.nd-dropdown-menu') as HTMLElement;
  const chevron = widget.querySelector('#nd-chevron') as HTMLElement;
  const btnIcon = widget.querySelector('#nd-btn-icon') as HTMLImageElement;
  const fallbackIcon = widget.querySelector('#nd-fallback-icon') as HTMLElement;

  if (btnIcon && fallbackIcon) {
    btnIcon.onerror = () => {
      btnIcon.style.display = 'none';
      fallbackIcon.style.display = 'inline-block';
    };
  }

  if (primaryBtn && dropdownMenu) {
    primaryBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isActive = dropdownMenu.classList.toggle('active');
      if (chevron) {
        chevron.style.transform = isActive ? 'rotate(180deg)' : 'rotate(0deg)';
      }
    });

    document.addEventListener('click', (e) => {
      if (!widget.contains(e.target as Node)) {
        dropdownMenu.classList.remove('active');
        if (chevron) chevron.style.transform = 'rotate(0deg)';
      }
    });
  }

  playerContainer.appendChild(widget);

  // Initial render with fallback & trigger async quality fetch
  const initial = buildFallbackQualities();
  renderYouTubeWidgetDropdown(initial);
  requestPagePlayerResponse();
  fetchQualitiesForUrl(window.location.href, undefined, (qualities) => {
    renderYouTubeWidgetDropdown(qualities);
  });
}


// Universal IDM-Style Floating Video Sniffer Bar for ALL Websites
let universalVideoBar: HTMLElement | null = null;
let activeHoveredVideo: HTMLVideoElement | null = null;
let barHideTimeout: any = null;
let periodicCheckInterval: any = null;

function findStreamUrlFromPerformance(): string | null {
  try {
    const entries = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
    for (let i = entries.length - 1; i >= 0; i--) {
      const name = entries[i].name;
      if (
        name &&
        name.startsWith('http') &&
        (name.includes('.m3u8') ||
          name.includes('.mpd') ||
          (name.includes('.mp4') && !name.includes('ad_') && !name.includes('/ads/')))
      ) {
        return name;
      }
    }
  } catch {}
  return null;
}

function normalizeDailymotionUrl(url: string): string | null {
  if (url.includes('dailymotion.com') || url.includes('dai.ly')) {
    try {
      if (url.includes('video=')) {
        const vid = url.split('video=')[1].split('&')[0].split('#')[0];
        if (vid) return `https://www.dailymotion.com/video/${vid.replace(/[^a-zA-Z0-9]/g, '')}`;
      }
      if (url.includes('videoId=')) {
        const vid = url.split('videoId=')[1].split('&')[0].split('#')[0];
        if (vid) return `https://www.dailymotion.com/video/${vid.replace(/[^a-zA-Z0-9]/g, '')}`;
      }
      const match = url.match(/\/video\/([a-zA-Z0-9]+)/) || url.match(/dai\.ly\/([a-zA-Z0-9]+)/);
      if (match && match[1]) {
        return `https://www.dailymotion.com/video/${match[1]}`;
      }
    } catch {}
  }
  return null;
}

function extractVideoTargetInfo(video: HTMLVideoElement): { targetUrl: string; title: string } {
  const currentSiteUrl = window.location.href;

  // 1. Dailymotion detection & canonical URL conversion
  const dmUrl =
    normalizeDailymotionUrl(currentSiteUrl) ||
    (video.currentSrc ? normalizeDailymotionUrl(video.currentSrc) : null);
  if (dmUrl) {
    let dmTitle =
      video.title ||
      video.getAttribute('aria-label') ||
      document.title.replace(/ - Dailymotion.*$/i, '').trim() ||
      'Dailymotion Video';
    return { targetUrl: dmUrl, title: dmTitle };
  }

  // 2. Check if major social media platform where page URL is best for yt-dlp
  const isSocialPlatform =
    currentSiteUrl.includes('youtube.com') ||
    currentSiteUrl.includes('youtu.be') ||
    currentSiteUrl.includes('facebook.com') ||
    currentSiteUrl.includes('fb.watch') ||
    currentSiteUrl.includes('instagram.com') ||
    currentSiteUrl.includes('tiktok.com') ||
    currentSiteUrl.includes('twitter.com') ||
    currentSiteUrl.includes('x.com') ||
    currentSiteUrl.includes('vimeo.com') ||
    currentSiteUrl.includes('reddit.com') ||
    currentSiteUrl.includes('twitch.tv') ||
    currentSiteUrl.includes('bilibili.com') ||
    currentSiteUrl.includes('pinterest.com') ||
    currentSiteUrl.includes('linkedin.com');

  // Check if inside a social media article/post with a permalink
  let permalink: string | null = null;
  const container = video.closest('article, [role="article"], [data-pagelet*="FeedUnit"], [data-testid*="tweet"], .tiktok-feed-item, div[class*="Post"]');
  if (container) {
    const postLink = container.querySelector('a[href*="/videos/"], a[href*="/reel/"], a[href*="/watch/"], a[href*="/status/"], a[href*="/p/"], a[href*="/comments/"]') as HTMLAnchorElement | null;
    if (postLink && postLink.href && postLink.href.startsWith('http')) {
      permalink = postLink.href;
    }
  }

  // 3. Direct video stream or MSE / HLS stream sniffing
  let directSrc = video.currentSrc || video.src;
  if (!directSrc || directSrc.startsWith('blob:') || directSrc.startsWith('data:')) {
    const sourceEl = video.querySelector('source') as HTMLSourceElement | null;
    if (sourceEl?.src && !sourceEl.src.startsWith('blob:')) {
      directSrc = sourceEl.src;
    }
  }

  // Check video data attributes (e.g. data-src, data-hls, data-stream)
  if (!directSrc || directSrc.startsWith('blob:')) {
    const dataSrc = video.getAttribute('data-src') || video.getAttribute('data-hls') || video.getAttribute('data-stream');
    if (dataSrc && dataSrc.startsWith('http')) {
      directSrc = dataSrc;
    }
  }

  // If still blob or empty, inspect performance resource timing for active .m3u8 / .mpd / .mp4 streams
  if (!directSrc || directSrc.startsWith('blob:')) {
    const perfStream = findStreamUrlFromPerformance();
    if (perfStream) {
      directSrc = perfStream;
    }
  }

  // Choose best target URL
  let targetUrl = currentSiteUrl;
  if (isSocialPlatform) {
    targetUrl = permalink || currentSiteUrl;
  } else if (directSrc && !directSrc.startsWith('blob:') && !directSrc.startsWith('data:')) {
    targetUrl = directSrc;
  } else {
    targetUrl = permalink || currentSiteUrl;
  }

  // Extract cleanest title possible
  let title =
    video.title ||
    video.getAttribute('aria-label') ||
    (container ? container.querySelector('h1, h2, h3, [data-testid="tweetText"], p')?.textContent?.trim() : '') ||
    document.title ||
    'Web Video';

  if (title.length > 80) {
    title = title.substring(0, 77) + '...';
  }

  return { targetUrl, title };
}

function ensureUniversalVideoBar(): HTMLElement {
  const root = document.fullscreenElement || document.body || document.documentElement;
  if (universalVideoBar && root.contains(universalVideoBar)) {
    return universalVideoBar;
  }

  if (universalVideoBar) {
    universalVideoBar.remove();
  }

  const bar = document.createElement('div');
  bar.id = 'nd-universal-video-bar';
  bar.innerHTML = `
    <div class="nd-bar-main-btn" id="nd-univ-main-btn" title="Click to Download or choose format">
      <img
        id="nd-univ-icon"
        src="${chrome.runtime.getURL('icons/48.png')}"
        width="16"
        height="16"
        style="border-radius: 4px; display: block; object-fit: contain; flex-shrink: 0;"
        alt="Nova"
      />
      <svg
        id="nd-univ-fallback-icon"
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2.5"
        stroke-linecap="round"
        stroke-linejoin="round"
        style="display: none; flex-shrink: 0; color: #fff;"
      >
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
        <polyline points="7 10 12 15 17 10"></polyline>
        <line x1="12" y1="15" x2="12" y2="3"></line>
      </svg>
      <span id="nd-univ-btn-text">NovaDownload</span>
      <svg id="nd-univ-chevron" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="transition: transform 0.2s; flex-shrink: 0;">
        <polyline points="6 9 12 15 18 9"></polyline>
      </svg>
    </div>

    <div class="nd-univ-dropdown-menu">
      <div style="padding: 10px; text-align: center; color: #94a3b8; font-size: 11px;">
        <span>🔍 Detecting qualities...</span>
      </div>
    </div>
  `;

  // Inject styles if not present
  if (!document.getElementById('novadownload-universal-bar-styles')) {
    const styleTag = document.createElement('style');
    styleTag.id = 'novadownload-universal-bar-styles';
    styleTag.textContent = `
      #nd-universal-video-bar {
        position: fixed !important;
        z-index: 2147483647 !important;
        display: none;
        flex-direction: column;
        align-items: flex-end;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important;
        user-select: none !important;
        pointer-events: auto !important;
        line-height: 1 !important;
        transition: opacity 0.2s ease, transform 0.2s ease;
      }
      .nd-bar-main-btn {
        display: flex;
        align-items: center;
        gap: 7px;
        background: linear-gradient(135deg, #0284c7 0%, #0369a1 100%) !important;
        color: #ffffff !important;
        padding: 6px 12px !important;
        border-radius: 8px !important;
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.6), 0 0 12px rgba(2, 132, 199, 0.45) !important;
        cursor: pointer !important;
        font-size: 11.5px !important;
        font-weight: 600 !important;
        border: 1px solid rgba(255, 255, 255, 0.4) !important;
        backdrop-filter: blur(8px);
        transition: background 0.2s, box-shadow 0.2s, transform 0.2s;
      }
      .nd-bar-main-btn:hover {
        background: linear-gradient(135deg, #0ea5e9 0%, #0284c7 100%) !important;
        box-shadow: 0 6px 20px rgba(0, 0, 0, 0.7), 0 0 16px rgba(14, 165, 233, 0.6) !important;
        transform: translateY(-1px);
      }
      .nd-univ-dropdown-menu {
        display: none;
        position: absolute;
        top: 100%;
        right: 0;
        margin-top: 5px;
        width: 250px;
        max-height: 300px;
        overflow-y: auto;
        background: #0f172a;
        border: 1px solid rgba(255, 255, 255, 0.18);
        border-radius: 9px;
        box-shadow: 0 12px 28px rgba(0, 0, 0, 0.75);
        padding: 5px;
        flex-direction: column;
        gap: 2px;
        backdrop-filter: blur(14px);
        z-index: 2147483647;
      }
      #nd-universal-video-bar:hover .nd-univ-dropdown-menu,
      .nd-univ-dropdown-menu.active {
        display: flex !important;
      }
      .nd-univ-menu-item {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 6px 9px;
        border-radius: 5px;
        color: #e2e8f0;
        font-size: 11px;
        font-weight: 500;
        cursor: pointer;
        transition: background 0.15s, color 0.15s;
      }
      .nd-univ-menu-item:hover {
        background: rgba(14, 165, 233, 0.25);
        color: #38bdf8;
      }
      .nd-univ-badge {
        font-size: 9px;
        padding: 2px 5px;
        border-radius: 3px;
        font-weight: 700;
        background: rgba(255, 255, 255, 0.1);
        color: #94a3b8;
        flex-shrink: 0;
      }
      .nd-univ-badge.hd {
        background: rgba(14, 165, 233, 0.3);
        color: #38bdf8;
      }
      .nd-univ-badge.audio {
        background: rgba(236, 72, 153, 0.25);
        color: #f472b6;
      }
    `;
    (document.head || document.documentElement).appendChild(styleTag);
  }

  const iconEl = bar.querySelector('#nd-univ-icon') as HTMLImageElement;
  const fallbackEl = bar.querySelector('#nd-univ-fallback-icon') as HTMLElement;
  if (iconEl && fallbackEl) {
    iconEl.onerror = () => {
      iconEl.style.display = 'none';
      fallbackEl.style.display = 'inline-block';
    };
  }

  const mainBtn = bar.querySelector('#nd-univ-main-btn');
  const dropdown = bar.querySelector('.nd-univ-dropdown-menu') as HTMLElement;
  const chevron = bar.querySelector('#nd-univ-chevron') as HTMLElement;

  bar.addEventListener('mouseenter', () => {
    if (barHideTimeout) {
      clearTimeout(barHideTimeout);
      barHideTimeout = null;
    }
    bar.style.opacity = '1';
  });

  bar.addEventListener('mouseleave', () => {
    scheduleBarFade();
  });

  if (mainBtn && dropdown) {
    mainBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      triggerUniversalDownload('best', false);
    });
  }

  root.appendChild(bar);
  universalVideoBar = bar;
  return bar;
}

function renderUniversalDropdown(qualities: DetectedQuality[]) {
  if (!universalVideoBar) return;
  const dropdownMenu = universalVideoBar.querySelector('.nd-univ-dropdown-menu');
  if (!dropdownMenu) return;

  dropdownMenu.innerHTML = `
    <div style="padding: 4px 8px 6px; font-size: 10px; color: #94a3b8; font-weight: 600; border-bottom: 1px solid rgba(255,255,255,0.1); margin-bottom: 4px; display: flex; justify-content: space-between; align-items: center;">
      <span>Detected Qualities</span>
      <span style="background: rgba(14, 165, 233, 0.2); color: #38bdf8; padding: 1px 5px; border-radius: 3px; font-size: 9px;">${qualities.length} Options</span>
    </div>
  `;

  for (const q of qualities) {
    const item = document.createElement('div');
    item.className = 'nd-univ-menu-item';
    item.setAttribute('data-format', q.id);
    item.setAttribute('data-audio', String(!!q.isAudio));
    if (q.fileSize) item.setAttribute('data-filesize', String(q.fileSize));

    const sizeStr = formatBytes(q.fileSize);
    const badgeClass = q.isAudio ? 'audio' : q.isBest ? 'hd' : q.resolution.includes('1080') || q.resolution.includes('4K') || q.resolution.includes('2K') ? 'hd' : '';

    item.innerHTML = `
      <div style="display: flex; align-items: center; gap: 5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
        <span>${q.isAudio ? '🎵' : '🎬'}</span>
        <span>${q.label}</span>
      </div>
      <div style="display: flex; align-items: center; gap: 5px; flex-shrink: 0;">
        ${sizeStr ? `<span style="font-size: 9px; color: #94a3b8; font-weight: 600;">${sizeStr}</span>` : ''}
        <span class="nd-univ-badge ${badgeClass}">${q.resolution}</span>
      </div>
    `;

    item.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      dropdownMenu.classList.remove('active');
      triggerUniversalDownload(q.id, !!q.isAudio, q.fileSize);
    });

    dropdownMenu.appendChild(item);
  }
}

function triggerUniversalDownload(formatId: string = 'best', isAudio: boolean = false, fileSize?: number) {
  if (!activeHoveredVideo) return;
  const { targetUrl, title } = extractVideoTargetInfo(activeHoveredVideo);
  const textEl = document.getElementById('nd-univ-btn-text');
  if (textEl) textEl.textContent = 'Sending...';

  chrome.runtime.sendMessage(
    {
      action: 'send_download',
      payload: {
        url: targetUrl,
        format_id: formatId,
        is_audio_only: isAudio,
        file_size: fileSize,
        referrer: window.location.href,
        title,
      },
    },
    (res) => {
      if (textEl) {
        textEl.textContent = res?.success ? '✓ Sent!' : '✓ Sent!';
        setTimeout(() => {
          if (textEl) textEl.textContent = 'NovaDownload';
        }, 2500);
      }
    }
  );
}

function updateBarPosition() {
  if (!activeHoveredVideo || !universalVideoBar) return;
  const rect = activeHoveredVideo.getBoundingClientRect();

  // If video is not visible, tiny, or out of viewport
  if (
    rect.width < 70 ||
    rect.height < 45 ||
    rect.bottom <= 0 ||
    rect.top >= window.innerHeight ||
    rect.right <= 0 ||
    rect.left >= window.innerWidth
  ) {
    universalVideoBar.style.display = 'none';
    return;
  }

  const barWidth = 135;
  const isFullscreen = !!document.fullscreenElement;

  if (isFullscreen && document.fullscreenElement) {
    // In fullscreen mode, attach to top-right of fullscreen container
    universalVideoBar.style.position = 'absolute';
    universalVideoBar.style.top = '16px';
    universalVideoBar.style.right = '16px';
    universalVideoBar.style.left = 'auto';
  } else {
    universalVideoBar.style.position = 'fixed';
    const topPos = Math.max(8, rect.top + 8);
    const leftPos = Math.max(8, Math.min(window.innerWidth - barWidth - 8, rect.right - barWidth - 8));
    universalVideoBar.style.top = `${topPos}px`;
    universalVideoBar.style.left = `${leftPos}px`;
    universalVideoBar.style.right = 'auto';
  }

  universalVideoBar.style.display = 'flex';
}

function scheduleBarFade() {
  if (barHideTimeout) clearTimeout(barHideTimeout);
  barHideTimeout = setTimeout(() => {
    // Only fade if video is paused or user is not hovering
    if (universalVideoBar) {
      universalVideoBar.style.display = 'none';
    }
  }, 4000);
}

function handleVideoDetected(video: HTMLVideoElement) {
  // If on YouTube watch page, let YouTube dedicated widget handle it
  if (
    window.location.hostname.includes('youtube.com') &&
    (window.location.pathname.startsWith('/watch') || window.location.pathname.startsWith('/shorts'))
  ) {
    return;
  }

  const rect = video.getBoundingClientRect();
  if (rect.width < 70 || rect.height < 45) return;

  activeHoveredVideo = video;
  ensureUniversalVideoBar();
  updateBarPosition();
  scheduleBarFade();

  // Trigger dynamic real-time quality detection for this video
  const { targetUrl } = extractVideoTargetInfo(video);
  const initial = buildFallbackQualities(video);
  renderUniversalDropdown(initial);
  fetchQualitiesForUrl(targetUrl, video, (qualities) => {
    renderUniversalDropdown(qualities);
  });
}


function scanForActiveVideos() {
  // Check YouTube skip
  if (
    window.location.hostname.includes('youtube.com') &&
    (window.location.pathname.startsWith('/watch') || window.location.pathname.startsWith('/shorts'))
  ) {
    return;
  }

  const videos = document.querySelectorAll('video');
  for (let i = 0; i < videos.length; i++) {
    const v = videos[i];
    if (!v.paused && !v.ended && v.currentTime > 0) {
      const rect = v.getBoundingClientRect();
      if (rect.width >= 100 && rect.height >= 70 && rect.top < window.innerHeight && rect.bottom > 0) {
        handleVideoDetected(v);
        return;
      }
    }
  }
}

// Global Capture Phase Event Listeners for Video Detection on ALL Websites
if (typeof window !== 'undefined') {
  // 1. Media playback events
  ['play', 'playing', 'timeupdate', 'loadeddata', 'loadedmetadata'].forEach((eventName) => {
    document.addEventListener(
      eventName,
      (e) => {
        if (e.target instanceof HTMLVideoElement) {
          handleVideoDetected(e.target);
        }
      },
      true
    );
  });

  // 2. Mouse / Pointer tracking (including through transparent overlays)
  const handlePointer = (e: MouseEvent) => {
    const target = e.target as HTMLElement;
    if (!target) return;

    if (target instanceof HTMLVideoElement) {
      handleVideoDetected(target);
      return;
    }

    // Check directly inside target or closest player container
    const video =
      target.querySelector?.('video') ||
      target.closest?.('video, [class*="player"], [class*="video"], [class*="media"], [class*="stream"], article, [role="article"]')?.querySelector?.('video');

    if (video instanceof HTMLVideoElement) {
      handleVideoDetected(video);
      return;
    }

    // Check underlying elements through overlays via elementsFromPoint
    if (e.clientX && e.clientY) {
      try {
        const elements = document.elementsFromPoint(e.clientX, e.clientY);
        for (const el of elements) {
          if (el instanceof HTMLVideoElement) {
            handleVideoDetected(el);
            return;
          }
        }
      } catch {}
    }
  };

  document.addEventListener('mouseover', handlePointer, true);
  document.addEventListener('pointerenter', handlePointer, true);

  // 3. Viewport and Fullscreen changes
  window.addEventListener('scroll', updateBarPosition, { passive: true });
  window.addEventListener('resize', updateBarPosition, { passive: true });
  document.addEventListener('fullscreenchange', () => {
    ensureUniversalVideoBar();
    updateBarPosition();
  });
  document.addEventListener('webkitfullscreenchange', () => {
    ensureUniversalVideoBar();
    updateBarPosition();
  });

  // 4. Periodic background scanner for playing media
  if (!periodicCheckInterval) {
    periodicCheckInterval = setInterval(scanForActiveVideos, 2000);
  }

  // 5. YouTube SPA navigation listener
  if (window.location.hostname.includes('youtube.com')) {
    window.addEventListener('yt-navigate-finish', () => {
      currentVideoTitle = '';
      lastFetchedUrl = '';
      lastActiveUrl = window.location.href;
      injectYouTubePlayerWidget();
    });
    window.addEventListener('load', injectYouTubePlayerWidget);
    setInterval(injectYouTubePlayerWidget, 1500);
  }
}

export {};

