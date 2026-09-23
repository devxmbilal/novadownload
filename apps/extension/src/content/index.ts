// NovaDownload Browser Extension - Content Script
// Injects IDM-Style Video Download Widget on YouTube Player

const BRIDGE_URL = 'http://127.0.0.1:64123';

// Listen for popup inspection messages
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
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

async function triggerDownload(formatId: string = 'best', isAudio: boolean = false) {
  const currentUrl = window.location.href;
  const statusEl = document.getElementById('nd-yt-status-text');
  if (statusEl) statusEl.innerText = 'Sending...';

  try {
    const response = await fetch(`${BRIDGE_URL}/api/v1/download`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: currentUrl,
        format_id: formatId,
        is_audio_only: isAudio,
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
        width: 210px;
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
}

// Observe YouTube SPA page changes
if (typeof window !== 'undefined' && window.location.hostname.includes('youtube.com')) {
  window.addEventListener('yt-navigate-finish', injectYouTubePlayerWidget);
  window.addEventListener('load', injectYouTubePlayerWidget);
  setInterval(injectYouTubePlayerWidget, 1500);
}

export {};
