const BRIDGE_URL = 'http://127.0.0.1:64123';

document.addEventListener('DOMContentLoaded', async () => {
  const statusBadge = document.getElementById('statusBadge')!;
  const statusText = document.getElementById('statusText')!;
  const urlInput = document.getElementById('downloadUrl') as HTMLInputElement;
  const sendBtn = document.getElementById('sendBtn') as HTMLButtonElement;
  const captureToggle = document.getElementById('captureToggle') as HTMLInputElement;
  const mediaItems = document.getElementById('mediaItems')!;
  const mediaCount = document.getElementById('mediaCount')!;

  // 1. Check desktop app connection
  try {
    const res = await fetch(`${BRIDGE_URL}/health`);
    if (res.ok) {
      statusBadge.className = 'status';
      statusText.textContent = 'Connected';
    } else {
      throw new Error();
    }
  } catch {
    statusBadge.className = 'status offline';
    statusText.textContent = 'Desktop Offline';
  }

  // 2. Load and sync Capture Downloads toggle
  chrome.runtime.sendMessage({ action: 'get_settings' }, (res) => {
    if (res && typeof res.captureDownloads === 'boolean') {
      captureToggle.checked = res.captureDownloads;
    }
  });

  captureToggle.addEventListener('change', () => {
    chrome.runtime.sendMessage({ action: 'set_capture', capture: captureToggle.checked });
  });

  // 3. Scan active tab for media & downloadable files
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
      chrome.tabs.sendMessage(tab.id, { action: 'get_media' }, (response) => {
        let mediaList: { url: string; title: string; type?: string }[] = response?.media || [];

        // If on YouTube/Facebook/Twitter/Instagram/TikTok and no raw streams found, offer page download
        if (mediaList.length === 0 && tab.url && (tab.url.startsWith('http://') || tab.url.startsWith('https://'))) {
          const u = tab.url.toLowerCase();
          const isMediaSite =
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
            u.includes('dailymotion.com');

          if (isMediaSite) {
            mediaList = [{ url: tab.url, title: tab.title || 'Web Video', type: 'Video' }];
          }
        }

        if (mediaList.length > 0) {
          mediaCount.textContent = `(${mediaList.length})`;
          mediaItems.innerHTML = '';
          mediaList.forEach((item) => {
            const div = document.createElement('div');
            div.className = 'media-item';
            div.innerHTML = `
              <div class="media-info">
                <span class="media-name" title="${item.title || item.url}">${item.title || item.url}</span>
                <span class="media-url" title="${item.url}">${item.url}</span>
              </div>
              <button class="media-btn" data-url="${item.url}" data-title="${encodeURIComponent(item.title || '')}">Download</button>
            `;
            mediaItems.appendChild(div);
          });

          // Attach listeners to media download buttons
          document.querySelectorAll('.media-btn').forEach((btn) => {
            btn.addEventListener('click', (e) => {
              const target = e.target as HTMLElement;
              const url = target.getAttribute('data-url');
              const title = decodeURIComponent(target.getAttribute('data-title') || '');
              if (url) {
                sendUrlToDesktop(url, tab.url, title);
              }
            });
          });
        }
      });
    }
  } catch {}

  // 4. Send manual URL
  sendBtn.addEventListener('click', () => {
    const url = urlInput.value.trim();
    if (url) {
      sendUrlToDesktop(url);
    }
  });

  urlInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const url = urlInput.value.trim();
      if (url) {
        sendUrlToDesktop(url);
      }
    }
  });
});

async function sendUrlToDesktop(url: string, referrer?: string, title?: string) {
  try {
    const token = (await chrome.storage.local.get('token'))?.token || '';
    const res = await fetch(`${BRIDGE_URL}/api/v1/download`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ url, referrer, title, token }),
    });

    if (res.ok) {
      window.close();
    } else {
      alert('Failed to send download to NovaDownload.');
    }
  } catch (err) {
    alert('NovaDownload Desktop App is not running.\nPlease start NovaDownload.');
  }
}

export {};
