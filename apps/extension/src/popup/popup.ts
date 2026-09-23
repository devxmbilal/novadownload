const BRIDGE_URL = 'http://127.0.0.1:64123';

document.addEventListener('DOMContentLoaded', async () => {
  const statusBadge = document.getElementById('statusBadge')!;
  const statusText = document.getElementById('statusText')!;
  const urlInput = document.getElementById('downloadUrl') as HTMLInputElement;
  const sendBtn = document.getElementById('sendBtn') as HTMLButtonElement;
  const mediaSection = document.getElementById('mediaSection')!;
  const mediaItems = document.getElementById('mediaItems')!;

  // Check desktop app connection
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

  // Get active tab URL or scanned media
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
      chrome.tabs.sendMessage(tab.id, { action: 'get_media' }, (response) => {
        if (response?.media && response.media.length > 0) {
          mediaSection.style.display = 'block';
          mediaItems.innerHTML = '';
          response.media.forEach((item: { url: string; title: string }) => {
            const div = document.createElement('div');
            div.className = 'media-item';
            div.innerHTML = `
              <span class="media-name" title="${item.url}">${item.title || item.url}</span>
              <button class="media-btn" data-url="${item.url}">Download</button>
            `;
            mediaItems.appendChild(div);
          });

          // Attach listeners to media download buttons
          document.querySelectorAll('.media-btn').forEach((btn) => {
            btn.addEventListener('click', (e) => {
              const url = (e.target as HTMLElement).getAttribute('data-url');
              if (url) sendUrlToDesktop(url, tab.url);
            });
          });
        }
      });
    }
  } catch {}

  sendBtn.addEventListener('click', () => {
    const url = urlInput.value.trim();
    if (url) {
      sendUrlToDesktop(url);
    }
  });
});

async function sendUrlToDesktop(url: string, referrer?: string) {
  try {
    const token = (await chrome.storage.local.get('token'))?.token || '';
    const res = await fetch(`${BRIDGE_URL}/api/v1/download`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ url, referrer, token }),
    });

    if (res.ok) {
      window.close();
    } else {
      alert('Failed to send download to NovaDownload.');
    }
  } catch (err) {
    alert('NovaDownload Desktop is not running.');
  }
}
