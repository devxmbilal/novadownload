// NovaDownload Extension Background Service Worker
// Automatically captures browser downloads, intercepts files/media, and handles context menus.

const BRIDGE_URL = 'http://127.0.0.1:64123';

// Set of recent URLs dispatched to NovaDownload to prevent loop interception
const dispatchedUrls = new Set<string>();

// Track whether automatic download capture is enabled (default: true)
let captureDownloads = true;

// Initialize settings from storage
chrome.storage.local.get(['captureDownloads', 'token'], (data) => {
  if (typeof data.captureDownloads === 'boolean') {
    captureDownloads = data.captureDownloads;
  } else {
    chrome.storage.local.set({ captureDownloads: true });
  }
});

// Listen for storage changes
chrome.storage.onChanged.addListener((changes) => {
  if (changes.captureDownloads) {
    captureDownloads = changes.captureDownloads.newValue;
  }
});

// Setup Context Menus for all media, links, images, and pages
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'novadownload-link',
      title: 'Download with NovaDownload',
      contexts: ['link'],
    });

    chrome.contextMenus.create({
      id: 'novadownload-image',
      title: 'Download Image with NovaDownload',
      contexts: ['image'],
    });

    chrome.contextMenus.create({
      id: 'novadownload-media',
      title: 'Download Video/Audio with NovaDownload',
      contexts: ['video', 'audio'],
    });

    chrome.contextMenus.create({
      id: 'novadownload-selection',
      title: 'Download Selected Link with NovaDownload',
      contexts: ['selection'],
    });

    chrome.contextMenus.create({
      id: 'novadownload-page',
      title: 'Download with NovaDownload (Current Page)',
      contexts: ['page'],
    });
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  let targetUrl = info.linkUrl || info.srcUrl;
  if (!targetUrl && info.selectionText) {
    const text = info.selectionText.trim();
    if (text.startsWith('http://') || text.startsWith('https://')) {
      targetUrl = text;
    }
  }
  if (!targetUrl && info.pageUrl) {
    targetUrl = info.pageUrl;
  }

  if (!targetUrl) return;
  await sendDownloadToDesktop({
    url: targetUrl,
    referrer: tab?.url,
    title: tab?.title,
  });
});

// Intercept browser downloads (like IDM)
if (chrome.downloads && chrome.downloads.onCreated) {
  chrome.downloads.onCreated.addListener(async (item) => {
    if (!captureDownloads) return;
    if (!item.url || item.url.startsWith('blob:') || item.url.startsWith('data:')) {
      return;
    }

    // Skip internal chrome/extension URLs
    if (
      item.url.startsWith('chrome://') ||
      item.url.startsWith('chrome-extension://') ||
      item.url.startsWith('moz-extension://')
    ) {
      return;
    }

    if (dispatchedUrls.has(item.url)) {
      return;
    }

    // Check if desktop app is alive
    try {
      const health = await fetch(`${BRIDGE_URL}/health`, { method: 'GET' });
      if (!health.ok) return;
    } catch {
      // Desktop app not running, let browser download proceed
      return;
    }

    // Mark as dispatched to avoid looping
    dispatchedUrls.add(item.url);
    setTimeout(() => dispatchedUrls.delete(item.url), 12000);

    // Cancel in browser
    try {
      await chrome.downloads.cancel(item.id);
      await chrome.downloads.erase({ id: item.id });
    } catch {}

    // Send to NovaDownload desktop
    const filename = item.filename ? item.filename.split(/[/\\]/).pop() : undefined;
    await sendDownloadToDesktop({
      url: item.finalUrl || item.url,
      file_name: filename,
      file_size: item.fileSize && item.fileSize > 0 ? item.fileSize : undefined,
      referrer: item.referrer,
      mime_type: item.mime,
    });
  });
}

// Support messages from content scripts and popup
chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (request.action === 'send_download') {
    sendDownloadToDesktop(request.payload).then((success) => {
      sendResponse({ success });
    });
    return true;
  }
  if (request.action === 'get_settings') {
    sendResponse({ captureDownloads });
    return true;
  }
  if (request.action === 'set_capture') {
    captureDownloads = !!request.capture;
    chrome.storage.local.set({ captureDownloads });
    sendResponse({ success: true, captureDownloads });
    return true;
  }
});

export interface DownloadRequestPayload {
  url: string;
  file_name?: string;
  file_size?: number;
  referrer?: string;
  format_id?: string;
  is_audio_only?: boolean;
  title?: string;
  mime_type?: string;
}

export async function sendDownloadToDesktop(payload: DownloadRequestPayload | string, referrer?: string): Promise<boolean> {
  const reqPayload: DownloadRequestPayload =
    typeof payload === 'string'
      ? { url: payload, referrer }
      : payload;

  try {
    const token = (await chrome.storage.local.get('token'))?.token || '';
    const response = await fetch(`${BRIDGE_URL}/api/v1/download`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        ...reqPayload,
        token: token || undefined,
      }),
    });

    if (!response.ok) {
      throw new Error(`Desktop returned status ${response.status}`);
    }

    const data = await response.json();
    console.log('Download dispatched successfully to NovaDownload:', data);
    return true;
  } catch (error) {
    console.error('Failed to communicate with NovaDownload desktop:', error);
    return false;
  }
}
