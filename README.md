# NovaDownload

<p align="center">
  <strong>Professional, High-Speed IDM-Style Desktop Download Manager</strong>
</p>

NovaDownload is a modern, fast, and feature-complete desktop download manager built with **Tauri 2**, **Rust**, **Tokio**, and **React**. It features multi-connection chunking, automatic resumption, bandwidth throttling, smart queues, scheduling, automatic file categorization, and seamless browser integration.

---

## Key Features

- **Multi-Connection Acceleration**: Splits files into up to 16 concurrent threads using HTTP Range requests for maximum bandwidth utilization.
- **Robust Resumption & Recovery**: Recovers from network loss, app restarts, and sudden power outages without corrupted files.
- **Atomic File Writing**: Writes safely to `.part` files and renames only after 100% completion and integrity checks.
- **Real-Time Speed & ETA Analytics**: Rolling 60-second speed history graph, average speed metrics, and dynamic ETA estimation.
- **Bandwidth Speed Limiter**: Global and per-download bandwidth throttling.
- **Queue & Scheduler**: Prioritized queues with concurrent download limits and automated time-of-day scheduling.
- **Smart Categorization**: Automatically organizes downloads into Videos, Music, Documents, Images, Archives, and Programs.
- **Clipboard URL Monitor**: Detects copied download links and prompts to download.
- **FFmpeg Integration**: Merges audio/video streams, extracts audio, and remuxes media formats safely.
- **Browser Extension**: One-click right-click context menu and popup download handoff for Chrome and Firefox.
- **Windows Tray Integration**: Minimizes to tray, supports background operations, and native desktop notifications.

---

## Tech Stack

- **Desktop Framework**: Tauri 2
- **Core Engine**: Rust, Tokio Async Runtime, reqwest, rusqlite, Serde, Tracing
- **Frontend**: React, TypeScript, Vite, Tailwind CSS, Lucide Icons, Zustand
- **Media Processing**: FFmpeg
- **Browser Extension**: Manifest V3 (Chrome) & Manifest V2 (Firefox)

---

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v18+)
- [Rust Toolchain](https://www.rust-lang.org/) (v1.75+)
- [FFmpeg](https://ffmpeg.org/) (Optional, for media stream workflows)

### Installation

```bash
# Clone the repository
git clone https://github.com/novadownload/novadownload.git
cd novadownload

# Install dependencies across all packages
npm install
```

### Development

```bash
# Start the local development test server
npm run test-server

# Run the Tauri desktop application in development mode
npm run tauri:dev
```

### Building for Production

```bash
# Build desktop installer and executable (.exe / .msi)
npm run tauri:build
```

---

## Testing

Start the built-in development test server to simulate various network scenarios:

```bash
npm run test-server
```

Test endpoints:
- `http://127.0.0.1:8088/files/small.zip` (1 MB test file)
- `http://127.0.0.1:8088/files/video.mp4` (100 MB video)
- `http://127.0.0.1:8088/files/large.iso` (1 GB file)
- `http://127.0.0.1:8088/files/slow.dat` (Throttled test stream)
- `http://127.0.0.1:8088/files/failing.bin` (Connection drop simulator)

---

## License

This project is licensed under the [MIT License](LICENSE).
