// Content script to inspect media elements on active tab

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'get_media') {
    const media: { url: string; title: string }[] = [];

    // Find all video sources
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
