# NovaDownload Database Design

NovaDownload utilizes SQLite with Write-Ahead Logging (`PRAGMA journal_mode = WAL;`) for high concurrency and low write latency.

## Main Tables

### `downloads`
Stores metadata and overall progress state for all download tasks.

| Field | Type | Description |
| :--- | :--- | :--- |
| `id` | TEXT PRIMARY KEY | Unique UUID identifier |
| `url` | TEXT NOT NULL | Download resource URL |
| `original_url` | TEXT NOT NULL | Original redirect source URL |
| `file_name` | TEXT NOT NULL | Sanitized destination filename |
| `file_path` | TEXT NOT NULL | Absolute destination file path |
| `directory` | TEXT NOT NULL | Destination folder path |
| `mime_type` | TEXT | Detected MIME type |
| `file_size` | INTEGER | Total file size in bytes (null if unknown) |
| `downloaded_size` | INTEGER NOT NULL | Bytes downloaded so far |
| `status` | TEXT NOT NULL | `pending`, `queued`, `downloading`, `paused`, `completed`, `failed`, `cancelled`, `merging` |
| `download_type` | TEXT NOT NULL | `http`, `media`, etc. |
| `total_connections`| INTEGER NOT NULL | Number of allocated connection chunks |
| `active_connections`| INTEGER NOT NULL | Currently active connection threads |
| `speed` | REAL NOT NULL | Current speed in bytes/sec |
| `average_speed` | REAL NOT NULL | Average session speed in bytes/sec |
| `eta` | INTEGER | Estimated seconds to completion |
| `error_message` | TEXT | Failure diagnostic message |
| `created_at` | TEXT NOT NULL | ISO 8601 creation timestamp |
| `started_at` | TEXT | ISO 8601 download start timestamp |
| `completed_at` | TEXT | ISO 8601 completion timestamp |
| `updated_at` | TEXT NOT NULL | ISO 8601 update timestamp |

### `download_chunks`
Stores partial range offsets and chunk statuses for multi-connection tasks.

| Field | Type | Description |
| :--- | :--- | :--- |
| `id` | TEXT PRIMARY KEY | Unique UUID |
| `download_id` | TEXT NOT NULL | Foreign key referencing `downloads(id)` |
| `chunk_index` | INTEGER NOT NULL | 0-indexed chunk thread index |
| `start_byte` | INTEGER NOT NULL | Range start offset |
| `end_byte` | INTEGER NOT NULL | Range end offset |
| `downloaded_bytes`| INTEGER NOT NULL | Bytes downloaded in this range |
| `status` | TEXT NOT NULL | `pending`, `downloading`, `completed`, `failed` |
| `etag` | TEXT | Server ETag header |
| `last_modified` | TEXT | Server Last-Modified header |

### `queues` & `queue_items`
Manages prioritized download queues and concurrent download thresholds.

### `schedules`
Stores automated time triggers (start time, end time, days of week).

### `settings`
Persistent key-value configuration.
