// NovaDownload Browser Extension - Content Script
// Injects IDM-Style Video Download Widget on YouTube Player with calculated format sizes

const BRIDGE_URL = 'http://127.0.0.1:64123';

interface FormatSizes {
  best?: number;
  '1080p'?: number;
  '720p'?: number;
  '480p'?: number;
  '360p'?: number;
  audio?: number;
}

let calculatedSizes: FormatSizes = {};
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

// Listen for popup inspection messages
chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (request.action === 'get_media') {
    const media: { url: string; title: string }[] = [];

    document.querySelectorAll('video, audio, source').forEach((el) => {
      const src = (el as HTMLMediaElement).src || (el as HTMLSourceElement).src;
      if (src && (src.startsWith('http://') || src.startsWith('https://'))) {
        const title = (el as HTMLMediaElement).title || document.title || 'Media Stream';
        if (!media.some((m) => m.url === src)) {
          media.push({ url: src, title });
        }
      }
    });

    sendResponse({ media });
  }
});

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

  // Find best audio stream (e.g. itag 140 or highest bitrate)
  const audioStreams = adaptiveFormats.filter((f) => f.mimeType && f.mimeType.startsWith('audio/'));
  const bestAudio =
    audioStreams.find((f) => f.itag === 140) ||
    audioStreams.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0];

  const audioBytes = bestAudio ? getStreamBytes(bestAudio) : 0;
  if (audioBytes > 0) {
    calculatedSizes.audio = audioBytes;
  }

  const resolutions: ('1080p' | '720p' | '480p' | '360p')[] = ['1080p', '720p', '480p', '360p'];
  for (const res of resolutions) {
    const numRes = parseInt(res, 10);
    const videoStream = adaptiveFormats.find((f) => {
      return f.height === numRes || (f.qualityLabel && f.qualityLabel.startsWith(res));
    });

    if (videoStream) {
      const videoBytes = getStreamBytes(videoStream);
      if (videoBytes > 0) {
        calculatedSizes[res] = videoBytes + audioBytes;
      }
    } else {
      const reg = regularFormats.find(
        (f) => f.height === numRes || (f.qualityLabel && f.qualityLabel.startsWith(res))
      );
      if (reg) {
        const regBytes = getStreamBytes(reg);
        if (regBytes > 0) {
          calculatedSizes[res] = regBytes;
        }
      }
    }
  }

  calculatedSizes.best =
    calculatedSizes['1080p'] ||
    calculatedSizes['720p'] ||
    calculatedSizes['480p'] ||
    calculatedSizes['360p'] ||
    undefined;

  renderSizesInWidget();
}

async function fetchSizesFromDesktopBridge(url: string) {
  if (lastFetchedUrl === url) return;
  lastFetchedUrl = url;

  try {
    const res = await fetch(`${BRIDGE_URL}/api/v1/media-info?url=${encodeURIComponent(url)}`);
    if (res.ok) {
      const data = await res.json();
      if (data.success && data.info) {
        updateWidgetSizesWithMediaInfo(data.info);
      }
    }
  } catch {}
}

function updateWidgetSizesWithMediaInfo(info: any) {
  if (!info) return;
  if (info.title) currentVideoTitle = info.title;
  const formats: any[] = info.formats || [];

  const audioFmt = formats
    .filter((f) => f.has_audio && !f.has_video)
    .sort((a, b) => (b.filesize || b.filesize_approx || 0) - (a.filesize || a.filesize_approx || 0))[0];
  if (audioFmt) {
    const sz = audioFmt.filesize || audioFmt.filesize_approx;
    if (sz) calculatedSizes.audio = sz;
  }

  const resolutions: ('1080p' | '720p' | '480p' | '360p')[] = ['1080p', '720p', '480p', '360p'];
  for (const res of resolutions) {
    const numRes = parseInt(res, 10);
    const vFmt = formats.find((f) => {
      return (
        f.resolution &&
        (f.resolution === res ||
          f.resolution.includes(`${numRes}p`) ||
          f.resolution.endsWith(`x${numRes}`))
      );
    });
    if (vFmt) {
      const sz = vFmt.filesize || vFmt.filesize_approx;
      if (sz) calculatedSizes[res] = sz;
    }
  }

  const bestFmt = formats
    .filter((f) => f.has_video)
    .sort((a, b) => (b.filesize || b.filesize_approx || 0) - (a.filesize || a.filesize_approx || 0))[0];
  if (bestFmt) {
    const sz = bestFmt.filesize || bestFmt.filesize_approx;
    if (sz) calculatedSizes.best = sz;
  }

  renderSizesInWidget();
}

function renderSizesInWidget() {
  const widget = document.getElementById('novadownload-yt-player-widget');
  if (!widget) return;

  const updateBadge = (selector: string, size?: number) => {
    const el = widget.querySelector(selector);
    if (!el) return;

    if (size && size > 0) {
      const formatted = formatBytes(size);
      let sizeEl = el.querySelector('.nd-size-badge');
      if (sizeEl) {
        sizeEl.textContent = formatted;
      } else {
        const span = document.createElement('span');
        span.className = 'nd-size-badge';
        span.style.cssText =
          'margin-left: auto; margin-right: 6px; font-family: monospace; font-size: 10px; color: #38bdf8; font-weight: 600; opacity: 0.95;';
        span.textContent = formatted;
        const badge = el.querySelector('.nd-badge');
        if (badge) {
          el.insertBefore(span, badge);
        } else {
          el.appendChild(span);
        }
      }
    }
  };

  updateBadge('.nd-menu-item[data-format="best"]', calculatedSizes.best);
  updateBadge('.nd-menu-item[data-format="1080p"]', calculatedSizes['1080p']);
  updateBadge('.nd-menu-item[data-format="720p"]', calculatedSizes['720p']);
  updateBadge('.nd-menu-item[data-format="480p"]', calculatedSizes['480p']);
  updateBadge('.nd-menu-item[data-format="360p"]', calculatedSizes['360p']);
  updateBadge('.nd-menu-item[data-format="audio"]', calculatedSizes.audio);
}

async function triggerDownload(formatId: string = 'best', isAudio: boolean = false) {
  const currentUrl = window.location.href;
  const statusEl = document.getElementById('nd-yt-status-text');
  if (statusEl) statusEl.innerText = 'Sending...';

  const chosenSize = calculatedSizes[formatId as keyof FormatSizes];

  try {
    const response = await fetch(`${BRIDGE_URL}/api/v1/download`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: currentUrl,
        format_id: formatId,
        is_audio_only: isAudio,
        file_size: chosenSize || undefined,
        title: currentVideoTitle || document.title.replace(' - YouTube', '').trim(),
        referrer: document.referrer,
      }),
    });

    if (response.ok) {
      if (statusEl) statusEl.innerText = '✓ Sent to NovaDownload!';
      setTimeout(() => {
        if (statusEl) statusEl.innerText = 'Download Video';
      }, 3000);
    } else {
      throw new Error();
    }
  } catch {
    if (statusEl) statusEl.innerText = '⚠️ Desktop App Offline';
    setTimeout(() => {
      if (statusEl) statusEl.innerText = 'Download Video';
    }, 3000);
  }
}

function injectYouTubePlayerWidget() {
  if (!window.location.hostname.includes('youtube.com')) return;
  const isVideoPage =
    window.location.pathname.startsWith('/watch') || window.location.pathname.startsWith('/shorts');

  const existingWidget = document.getElementById('novadownload-yt-player-widget');

  if (!isVideoPage) {
    if (existingWidget) existingWidget.remove();
    return;
  }

  // Find the video player element
  const playerContainer =
    document.querySelector('#movie_player') ||
    document.querySelector('ytd-player') ||
    document.querySelector('#player-container') ||
    document.body;

  if (!playerContainer) return;

  if (existingWidget) {
    // If it's not attached to the current playerContainer, re-attach
    if (!playerContainer.contains(existingWidget) && playerContainer !== document.body) {
      playerContainer.appendChild(existingWidget);
    }
    // Also try to request page player data to refresh format sizes
    requestPagePlayerResponse();
    fetchSizesFromDesktopBridge(window.location.href);
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

  // Inject Styles for the widget and dropdown
  if (!document.getElementById('novadownload-widget-styles')) {
    const styleTag = document.createElement('style');
    styleTag.id = 'novadownload-widget-styles';
    styleTag.textContent = `
      #novadownload-yt-player-widget {
        opacity: 0.92;
        transition: opacity 0.2s, transform 0.2s;
      }
      #novadownload-yt-player-widget:hover {
        opacity: 1;
        transform: translateY(-1px);
      }
      .nd-main-btn {
        display: flex;
        align-items: center;
        gap: 7px;
        background: linear-gradient(135deg, #0e8ce9 0%, #0369a1 100%);
        color: #ffffff;
        padding: 7px 13px;
        border-radius: 8px;
        box-shadow: 0 4px 14px rgba(0, 0, 0, 0.45), 0 0 10px rgba(14, 140, 233, 0.4);
        cursor: pointer;
        font-size: 12px;
        font-weight: 600;
        border: 1px solid rgba(255, 255, 255, 0.3);
        backdrop-filter: blur(8px);
      }
      .nd-main-btn:hover {
        background: linear-gradient(135deg, #1fa2ff 0%, #0284c7 100%);
      }
      .nd-dropdown-menu {
        display: none;
        position: absolute;
        top: 100%;
        right: 0;
        margin-top: 6px;
        width: 235px;
        background: #0f172a;
        border: 1px solid rgba(255, 255, 255, 0.15);
        border-radius: 10px;
        box-shadow: 0 12px 28px rgba(0, 0, 0, 0.65);
        padding: 5px;
        flex-direction: column;
        gap: 2px;
        backdrop-filter: blur(12px);
      }
      #novadownload-yt-player-widget:hover .nd-dropdown-menu {
        display: flex;
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
        background: rgba(14, 140, 233, 0.25);
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
        background: rgba(14, 140, 233, 0.3);
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
    <div class="nd-main-btn" id="nd-primary-btn">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
        <polyline points="7 10 12 15 17 10"></polyline>
        <line x1="12" y1="15" x2="12" y2="3"></line>
      </svg>
      <span id="nd-yt-status-text">Download Video</span>
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
        <polyline points="6 9 12 15 18 9"></polyline>
      </svg>
    </div>

    <div class="nd-dropdown-menu">
      <div class="nd-menu-item" data-format="best" data-audio="false">
        <span>🎬 Best Available Quality</span>
        <span class="nd-badge hd">Auto</span>
      </div>
      <div class="nd-menu-item" data-format="1080p" data-audio="false">
        <span>🎬 1080p Full HD</span>
        <span class="nd-badge hd">1080p</span>
      </div>
      <div class="nd-menu-item" data-format="720p" data-audio="false">
        <span>🎬 720p HD</span>
        <span class="nd-badge hd">720p</span>
      </div>
      <div class="nd-menu-item" data-format="480p" data-audio="false">
        <span>🎬 480p SD</span>
        <span class="nd-badge">480p</span>
      </div>
      <div class="nd-menu-item" data-format="360p" data-audio="false">
        <span>🎬 360p Normal</span>
        <span class="nd-badge">360p</span>
      </div>
      <div class="nd-menu-item" data-format="audio" data-audio="true" style="border-top: 1px solid rgba(255,255,255,0.1); margin-top: 3px; padding-top: 7px;">
        <span>🎵 Audio Only (MP3)</span>
        <span class="nd-badge audio">MP3</span>
      </div>
    </div>
  `;

  // Click on main button -> triggers best quality download
  const primaryBtn = widget.querySelector('#nd-primary-btn');
  if (primaryBtn) {
    primaryBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      triggerDownload('best', false);
    });
  }

  // Click on dropdown items
  const menuItems = widget.querySelectorAll('.nd-menu-item');
  menuItems.forEach((item) => {
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      const format = item.getAttribute('data-format') || 'best';
      const isAudio = item.getAttribute('data-audio') === 'true';
      triggerDownload(format, isAudio);
    });
  });

  playerContainer.appendChild(widget);

  // Request page player data for format sizes
  requestPagePlayerResponse();
  fetchSizesFromDesktopBridge(window.location.href);
}

// Observe YouTube SPA page changes
if (typeof window !== 'undefined' && window.location.hostname.includes('youtube.com')) {
  window.addEventListener('yt-navigate-finish', () => {
    calculatedSizes = {};
    injectYouTubePlayerWidget();
  });
  window.addEventListener('load', injectYouTubePlayerWidget);
  setInterval(injectYouTubePlayerWidget, 1500);
}

export {};
