# NovaDownload Browser Extension Integration

The browser extension integrates Google Chrome and Mozilla Firefox with the NovaDownload desktop application.

## Communication Architecture

```
[ Web Browser ]
      |
 (Right-Click Context Menu / Popup Download)
      |
      v
[ Background Service Worker ]
      |
 (HTTP POST http://127.0.0.1:64123/api/v1/download)
      |
      v
[ NovaDownload Axum Bridge ]
      |
 (Tauri Event: browser:download_received)
      |
      v
[ Desktop React UI: Add Download Dialog ]
```

## Features
1. **Context Menu**: Right-click links or media elements to download instantly with NovaDownload.
2. **Media Sniffing**: Inspects active web pages for `<video>` and `<audio>` stream URLs.
3. **Authentication**: Uses a local bearer token stored in desktop settings to secure IPC communication.
