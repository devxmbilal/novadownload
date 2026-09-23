// NovaDownload Content Script & YouTube Floating Download Grabber

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

// YouTube Floating Downloader Button Injection
function injectYouTubeDownloadButton() {
  if (!window.location.hostname.includes('youtube.com')) return;
  const isVideoPage =
    window.location.pathname.startsWith('/watch') || window.location.pathname.startsWith('/shorts');
  
  const existingBtn = document.getElementById('novadownload-yt-btn');
  if (!isVideoPage) {
    if (existingBtn) existingBtn.remove();
    return;
  }

  if (existingBtn) return;

  const btnContainer = document.createElement('div');
  btnContainer.id = 'novadownload-yt-btn';
  btnContainer.style.cssText = `
    position: fixed;
    bottom: 28px;
    right: 28px;
    z-index: 999999999;
    display: flex;
    align-items: center;
    gap: 8px;
    background: linear-gradient(135deg, #0e8ce9 0%, #0266b3 100%);
    color: #ffffff;
    padding: 10px 16px;
    border-radius: 9999px;
    box-shadow: 0 10px 25px -5px rgba(14, 140, 233, 0.55), 0 8px 10px -6px rgba(0, 0, 0, 0.35);
    cursor: pointer;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    font-size: 12.5px;
    font-weight: 600;
    transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
    border: 1px solid rgba(255, 255, 255, 0.3);
    backdrop-filter: blur(10px);
    user-select: none;
  `;

  btnContainer.innerHTML = `
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink: 0;">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
      <polyline points="7 10 12 15 17 10"></polyline>
      <line x1="12" y1="15" x2="12" y2="3"></line>
    </svg>
    <span id="novadownload-btn-text">Download with NovaDownload</span>
  `;

  btnContainer.onmouseenter = () => {
    btnContainer.style.transform = 'translateY(-2px) scale(1.03)';
    btnContainer.style.boxShadow = '0 15px 30px -5px rgba(14, 140, 233, 0.65), 0 10px 10px -5px rgba(0, 0, 0, 0.4)';
  };

  btnContainer.onmouseleave = () => {
    btnContainer.style.transform = 'translateY(0) scale(1)';
    btnContainer.style.boxShadow = '0 10px 25px -5px rgba(14, 140, 233, 0.55), 0 8px 10px -6px rgba(0, 0, 0, 0.35)';
  };

  btnContainer.onclick = async (e) => {
    e.stopPropagation();
    const textSpan = document.getElementById('novadownload-btn-text');
    if (textSpan) textSpan.innerText = 'Sending to NovaDownload...';

    const currentUrl = window.location.href;
    try {
      const response = await fetch(`${BRIDGE_URL}/api/v1/download`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: currentUrl,
          referrer: document.referrer,
        }),
      });

      if (response.ok) {
        if (textSpan) textSpan.innerText = '✓ Sent to NovaDownload!';
        btnContainer.style.background = 'linear-gradient(135deg, #10b981 0%, #059669 100%)';
        setTimeout(() => {
          if (textSpan) textSpan.innerText = 'Download with NovaDownload';
          btnContainer.style.background = 'linear-gradient(135deg, #0e8ce9 0%, #0266b3 100%)';
        }, 3000);
      } else {
        throw new Error('Desktop returned non-OK');
      }
    } catch {
      if (textSpan) textSpan.innerText = '⚠️ NovaDownload is offline';
      btnContainer.style.background = 'linear-gradient(135deg, #ef4444 0%, #b91c1c 100%)';
      setTimeout(() => {
        if (textSpan) textSpan.innerText = 'Download with NovaDownload';
        btnContainer.style.background = 'linear-gradient(135deg, #0e8ce9 0%, #0266b3 100%)';
      }, 3000);
    }
  };

  document.body.appendChild(btnContainer);
}

// Observe YouTube SPA page changes
if (typeof window !== 'undefined' && window.location.hostname.includes('youtube.com')) {
  window.addEventListener('yt-navigate-finish', injectYouTubeDownloadButton);
  window.addEventListener('load', injectYouTubeDownloadButton);
  setInterval(injectYouTubeDownloadButton, 1500);
}

export {};

