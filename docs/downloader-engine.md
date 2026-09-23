# NovaDownload Downloader Engine Specification

The download engine is designed to maximize network throughput on HTTP/HTTPS connections while ensuring fault tolerance, crash resistance, and low RAM utilization.

## Download Flow

1. **URL Pre-Flight Probe**:
   - Performs a `HEAD` request to read headers: `Content-Length`, `Accept-Ranges`, `Content-Disposition`, `ETag`, `Last-Modified`.
   - If `HEAD` is disabled by the remote server, sends a lightweight `GET` with header `Range: bytes=0-0`.
2. **Chunk Allocation**:
   - If `Accept-Ranges: bytes` is present and total file size is known:
     - The file is divided into $N$ equal segments where $N \in [1, 16]$.
     - Chunk records are persisted to SQLite.
   - If Range is not supported:
     - Falls back to single-stream downloading with append support.
3. **Random Access File Writing**:
   - A `.part` temporary file is created at `target_path.part`.
   - Each worker seeks to `start_byte + downloaded_bytes` and streams buffers directly to disk.
   - No entire files or large chunks are held in RAM.
4. **Resumption & Crash Recovery**:
   - Upon restart, uncompleted downloads are set to `Paused`.
   - Resuming inspects the database and `.part` file, querying only the remaining byte range `Range: bytes={start + downloaded}-{end}`.
5. **Atomic Finalization**:
   - When all bytes are verified, `.part` is atomically renamed to the final destination name.
