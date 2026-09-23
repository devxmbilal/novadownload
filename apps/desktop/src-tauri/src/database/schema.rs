pub const CREATE_TABLES_SQL: &str = r#"
CREATE TABLE IF NOT EXISTS downloads (
    id TEXT PRIMARY KEY,
    url TEXT NOT NULL,
    original_url TEXT NOT NULL,
    file_name TEXT NOT NULL,
    file_path TEXT NOT NULL,
    directory TEXT NOT NULL,
    mime_type TEXT,
    file_size INTEGER,
    downloaded_size INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL,
    download_type TEXT NOT NULL DEFAULT 'http',
    total_connections INTEGER NOT NULL DEFAULT 1,
    active_connections INTEGER NOT NULL DEFAULT 0,
    speed REAL NOT NULL DEFAULT 0.0,
    average_speed REAL NOT NULL DEFAULT 0.0,
    eta INTEGER,
    error_message TEXT,
    thumbnail TEXT,
    created_at TEXT NOT NULL,
    started_at TEXT,
    completed_at TEXT,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS download_chunks (
    id TEXT PRIMARY KEY,
    download_id TEXT NOT NULL,
    chunk_index INTEGER NOT NULL,
    start_byte INTEGER NOT NULL,
    end_byte INTEGER NOT NULL,
    downloaded_bytes INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL,
    etag TEXT,
    last_modified TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (download_id) REFERENCES downloads(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS queues (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    max_concurrent_downloads INTEGER NOT NULL DEFAULT 3,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS queue_items (
    id TEXT PRIMARY KEY,
    queue_id TEXT NOT NULL,
    download_id TEXT NOT NULL,
    position INTEGER NOT NULL,
    priority INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (queue_id) REFERENCES queues(id) ON DELETE CASCADE,
    FOREIGN KEY (download_id) REFERENCES downloads(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS schedules (
    id TEXT PRIMARY KEY,
    download_id TEXT,
    queue_id TEXT,
    start_at TEXT,
    end_at TEXT,
    days_of_week TEXT NOT NULL DEFAULT '',
    enabled INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS download_history (
    id TEXT PRIMARY KEY,
    download_id TEXT NOT NULL,
    action TEXT NOT NULL,
    metadata TEXT,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_downloads_status ON downloads(status);
CREATE INDEX IF NOT EXISTS idx_downloads_created_at ON downloads(created_at);
CREATE INDEX IF NOT EXISTS idx_downloads_url ON downloads(url);
CREATE INDEX IF NOT EXISTS idx_chunks_download_id ON download_chunks(download_id);
CREATE INDEX IF NOT EXISTS idx_queue_items_queue_pos ON queue_items(queue_id, position);
"#;
