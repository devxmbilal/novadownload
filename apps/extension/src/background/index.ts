// NovaDownload Extension Background Service Worker

const BRIDGE_URL = 'http://127.0.0.1:64123';

chrome.runtime.onInstalled.addListener(() => {
  // Create context menus for right-click download
  chrome.contextMenus.create({
    id: 'novadownload-link',
    title: 'Download with NovaDownload',
    contexts: ['link'],
  });

  chrome.contextMenus.create({
    id: 'novadownload-media',
    title: 'Download Media with NovaDownload',
    contexts: ['image', 'video', 'audio'],
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const targetUrl = info.linkUrl || info.srcUrl || info.pageUrl;
  if (!targetUrl) return;

  await sendDownloadToDesktop(targetUrl, tab?.url);
});

export async function sendDownloadToDesktop(url: string, referrer?: string) {
  try {
    const token = (await chrome.storage.local.get('token'))?.token || '';
    const response = await fetch(`${BRIDGE_URL}/api/v1/download`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        url,
        referrer,
        token,
      }),
    });

    if (!response.ok) {
      throw new Error(`Desktop returned status ${response.status}`);
    }

    const data = await response.json();
    console.log('Download dispatched successfully to NovaDownload:', data);
  } catch (error) {
    console.error('Failed to communicate with NovaDownload desktop:', error);
    // Notify user
    chrome.notifications?.create({
      type: 'basic',
      iconUrl: 'icon-128.png',
      title: 'NovaDownload Desktop Offline',
      message: 'Make sure NovaDownload is running on your computer.',
    });
  }
}
