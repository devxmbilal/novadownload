# NovaDownload Architecture

NovaDownload is a modular, high-performance desktop download manager built on Tauri 2, Tokio async runtime, and React 18/19.

## High-Level Diagram

```
+-------------------------------------------------------------+
|                     React Desktop UI                        |
|   (Zustand Stores, Tailwind CSS, Lucide Icons, Speed Graph) |
+------------------------------+------------------------------+
                               |
                   Tauri Commands & Events
                               |
+------------------------------v------------------------------+
|                   Rust Application Core                     |
|                                                             |
|  +---------------------+        +------------------------+  |
|  |   Download Engine   |<------>|     Chunk Manager      |  |
|  +----------+----------+        +------------------------+  |
|             |                                               |
|  +----------v----------+        +------------------------+  |
|  |    Queue Manager    |<------>|   Scheduler Service    |  |
|  +---------------------+        +------------------------+  |
|                                                             |
|  +---------------------+        +------------------------+  |
|  |    Speed Limiter    |        |     FFmpeg Service     |  |
|  +---------------------+        +------------------------+  |
|                                                             |
|  +---------------------+        +------------------------+  |
|  |   Database Layer    |        |   Browser Extension    |  |
|  |      (SQLite)       |        |     Bridge (Axum)      |  |
|  +---------------------+        +------------------------+  |
+-------------------------------------------------------------+
```

## Core Modules

### 1. Download Engine (`downloader/`)
- **Probe**: Uses `HEAD` and HTTP Range `bytes=0-0` queries to detect `Accept-Ranges`, `Content-Length`, `Content-Type`, `ETag`, and `Last-Modified`.
- **Multi-Connection Chunking**: Divides files into configurable chunks (1 to 16 threads).
- **Single-Connection Fallback**: Automatically streams data sequentially if Range requests are not supported.
- **Atomic File Writing**: Writes to `.part` files and atomically renames to the final target upon successful checksum/completion.
- **Speed Calculation**: Sliding window tracking for rolling speed, overall average speed, and dynamic ETA estimation.

### 2. Database Persistence (`database/`)
- SQLite database embedded at `%APPDATA%/NovaDownload/novadownload.db`.
- Atomic migrations and indexed tables: `downloads`, `download_chunks`, `queues`, `queue_items`, `schedules`, `settings`, `download_history`.
- Automatic crash recovery of interrupted sessions.

### 3. Media Processing (`ffmpeg/`)
- Probes system FFmpeg binaries.
- Executes safe subprocess calls for audio extraction, media remuxing, and video/audio stream merging.

### 4. Browser Integration (`browser/`)
- Local HTTP bridge running on port 64123 with token validation.
- Chrome Manifest V3 and Firefox extensions forward downloads and captured streams directly to desktop.
