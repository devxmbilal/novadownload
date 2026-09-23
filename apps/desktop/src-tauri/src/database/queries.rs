use crate::errors::AppResult;
use crate::models::*;
use chrono::{DateTime, Utc};
use rusqlite::{params, Connection, OptionalExtension};
use std::sync::Arc;
use tokio::sync::Mutex;

#[derive(Clone)]
pub struct Database {
    conn: Arc<Mutex<Connection>>,
}

impl Database {
    pub fn new(connection: Connection) -> Self {
        Self {
            conn: Arc::new(Mutex::new(connection)),
        }
    }

    pub async fn init(&self) -> AppResult<()> {
        let conn = self.conn.lock().await;
        let _ = conn.pragma_update(None, "journal_mode", "WAL");
        let _ = conn.pragma_update(None, "synchronous", "NORMAL");
        let _ = conn.pragma_update(None, "foreign_keys", "ON");
        conn.execute_batch(crate::database::schema::CREATE_TABLES_SQL)?;
        
        // Ensure default queue exists
        let exists: i64 = conn.query_row(
            "SELECT COUNT(*) FROM queues WHERE id = 'general'",
            [],
            |r| r.get(0),
        ).unwrap_or(0);

        if exists == 0 {
            conn.execute(
                "INSERT INTO queues (id, name, max_concurrent_downloads, is_active, created_at) VALUES (?, ?, ?, ?, ?)",
                params!["general", "General Queue", 3, 1, Utc::now().to_rfc3339()],
            )?;
        }

        Ok(())
    }

    // --- Downloads CRUD ---
    pub async fn insert_download(&self, dl: &Download) -> AppResult<()> {
        let conn = self.conn.lock().await;
        conn.execute(
            r#"INSERT INTO downloads (
                id, url, original_url, file_name, file_path, directory,
                mime_type, file_size, downloaded_size, status, download_type,
                total_connections, active_connections, speed, average_speed,
                eta, error_message, created_at, started_at, completed_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"#,
            params![
                dl.id,
                dl.url,
                dl.original_url,
                dl.file_name,
                dl.file_path,
                dl.directory,
                dl.mime_type,
                dl.file_size,
                dl.downloaded_size,
                dl.status.to_string(),
                dl.download_type,
                dl.total_connections,
                dl.active_connections,
                dl.speed,
                dl.average_speed,
                dl.eta,
                dl.error_message,
                dl.created_at.to_rfc3339(),
                dl.started_at.map(|t| t.to_rfc3339()),
                dl.completed_at.map(|t| t.to_rfc3339()),
                dl.updated_at.to_rfc3339(),
            ],
        )?;
        Ok(())
    }

    pub async fn get_download(&self, id: &str) -> AppResult<Option<Download>> {
        let conn = self.conn.lock().await;
        let mut stmt = conn.prepare(
            r#"SELECT id, url, original_url, file_name, file_path, directory,
                      mime_type, file_size, downloaded_size, status, download_type,
                      total_connections, active_connections, speed, average_speed,
                      eta, error_message, created_at, started_at, completed_at, updated_at
               FROM downloads WHERE id = ?"#,
        )?;

        let dl = stmt
            .query_row(params![id], |row| {
                let status_str: String = row.get(9)?;
                let created_str: String = row.get(17)?;
                let started_str: Option<String> = row.get(18)?;
                let completed_str: Option<String> = row.get(19)?;
                let updated_str: String = row.get(20)?;

                Ok(Download {
                    id: row.get(0)?,
                    url: row.get(1)?,
                    original_url: row.get(2)?,
                    file_name: row.get(3)?,
                    file_path: row.get(4)?,
                    directory: row.get(5)?,
                    mime_type: row.get(6)?,
                    file_size: row.get(7)?,
                    downloaded_size: row.get(8)?,
                    status: DownloadStatus::from(status_str.as_str()),
                    download_type: row.get(10)?,
                    total_connections: row.get(11)?,
                    active_connections: row.get(12)?,
                    speed: row.get(13)?,
                    average_speed: row.get(14)?,
                    eta: row.get(15)?,
                    error_message: row.get(16)?,
                    created_at: DateTime::parse_from_rfc3339(&created_str)
                        .map(|t| t.with_timezone(&Utc))
                        .unwrap_or_else(|_| Utc::now()),
                    started_at: started_str
                        .and_then(|s| DateTime::parse_from_rfc3339(&s).ok())
                        .map(|t| t.with_timezone(&Utc)),
                    completed_at: completed_str
                        .and_then(|s| DateTime::parse_from_rfc3339(&s).ok())
                        .map(|t| t.with_timezone(&Utc)),
                    updated_at: DateTime::parse_from_rfc3339(&updated_str)
                        .map(|t| t.with_timezone(&Utc))
                        .unwrap_or_else(|_| Utc::now()),
                })
            })
            .optional()?;

        Ok(dl)
    }

    pub async fn list_downloads(&self) -> AppResult<Vec<Download>> {
        let conn = self.conn.lock().await;
        let mut stmt = conn.prepare(
            r#"SELECT id, url, original_url, file_name, file_path, directory,
                      mime_type, file_size, downloaded_size, status, download_type,
                      total_connections, active_connections, speed, average_speed,
                      eta, error_message, created_at, started_at, completed_at, updated_at
               FROM downloads ORDER BY created_at DESC"#,
        )?;

        let iter = stmt.query_map([], |row| {
            let status_str: String = row.get(9)?;
            let created_str: String = row.get(17)?;
            let started_str: Option<String> = row.get(18)?;
            let completed_str: Option<String> = row.get(19)?;
            let updated_str: String = row.get(20)?;

            Ok(Download {
                id: row.get(0)?,
                url: row.get(1)?,
                original_url: row.get(2)?,
                file_name: row.get(3)?,
                file_path: row.get(4)?,
                directory: row.get(5)?,
                mime_type: row.get(6)?,
                file_size: row.get(7)?,
                downloaded_size: row.get(8)?,
                status: DownloadStatus::from(status_str.as_str()),
                download_type: row.get(10)?,
                total_connections: row.get(11)?,
                active_connections: row.get(12)?,
                speed: row.get(13)?,
                average_speed: row.get(14)?,
                eta: row.get(15)?,
                error_message: row.get(16)?,
                created_at: DateTime::parse_from_rfc3339(&created_str)
                    .map(|t| t.with_timezone(&Utc))
                    .unwrap_or_else(|_| Utc::now()),
                started_at: started_str
                    .and_then(|s| DateTime::parse_from_rfc3339(&s).ok())
                    .map(|t| t.with_timezone(&Utc)),
                completed_at: completed_str
                    .and_then(|s| DateTime::parse_from_rfc3339(&s).ok())
                    .map(|t| t.with_timezone(&Utc)),
                updated_at: DateTime::parse_from_rfc3339(&updated_str)
                    .map(|t| t.with_timezone(&Utc))
                    .unwrap_or_else(|_| Utc::now()),
            })
        })?;

        let mut list = Vec::new();
        for item in iter {
            list.push(item?);
        }
        Ok(list)
    }

    pub async fn update_download_status(
        &self,
        id: &str,
        status: DownloadStatus,
        error_msg: Option<&str>,
    ) -> AppResult<()> {
        let conn = self.conn.lock().await;
        let now = Utc::now().to_rfc3339();
        let status_str = status.to_string();

        match status {
            DownloadStatus::Downloading => {
                conn.execute(
                    "UPDATE downloads SET status = ?, started_at = COALESCE(started_at, ?), updated_at = ?, error_message = NULL WHERE id = ?",
                    params![status_str, now, now, id],
                )?;
            }
            DownloadStatus::Completed => {
                conn.execute(
                    "UPDATE downloads SET status = ?, completed_at = ?, updated_at = ?, speed = 0, eta = 0, active_connections = 0 WHERE id = ?",
                    params![status_str, now, now, id],
                )?;
            }
            DownloadStatus::Failed => {
                conn.execute(
                    "UPDATE downloads SET status = ?, error_message = ?, updated_at = ?, speed = 0, eta = 0, active_connections = 0 WHERE id = ?",
                    params![status_str, error_msg, now, id],
                )?;
            }
            _ => {
                conn.execute(
                    "UPDATE downloads SET status = ?, updated_at = ?, speed = 0, eta = 0, active_connections = 0 WHERE id = ?",
                    params![status_str, now, id],
                )?;
            }
        }
        Ok(())
    }

    pub async fn update_download_progress(
        &self,
        id: &str,
        downloaded_size: i64,
        speed: f64,
        average_speed: f64,
        eta: Option<i64>,
        active_connections: u32,
    ) -> AppResult<()> {
        let conn = self.conn.lock().await;
        let now = Utc::now().to_rfc3339();
        conn.execute(
            "UPDATE downloads SET downloaded_size = ?, speed = ?, average_speed = ?, eta = ?, active_connections = ?, updated_at = ? WHERE id = ?",
            params![downloaded_size, speed, average_speed, eta, active_connections, now, id],
        )?;
        Ok(())
    }

    pub async fn delete_download(&self, id: &str) -> AppResult<()> {
        let conn = self.conn.lock().await;
        conn.execute("DELETE FROM downloads WHERE id = ?", params![id])?;
        Ok(())
    }

    // --- Chunks CRUD ---
    pub async fn insert_chunks(&self, chunks: &[DownloadChunk]) -> AppResult<()> {
        let conn = self.conn.lock().await;
        for c in chunks {
            conn.execute(
                r#"INSERT OR REPLACE INTO download_chunks (
                    id, download_id, chunk_index, start_byte, end_byte,
                    downloaded_bytes, status, etag, last_modified, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"#,
                params![
                    c.id,
                    c.download_id,
                    c.chunk_index,
                    c.start_byte,
                    c.end_byte,
                    c.downloaded_bytes,
                    c.status,
                    c.etag,
                    c.last_modified,
                    c.created_at.to_rfc3339(),
                    c.updated_at.to_rfc3339(),
                ],
            )?;
        }
        Ok(())
    }

    pub async fn get_chunks_for_download(&self, download_id: &str) -> AppResult<Vec<DownloadChunk>> {
        let conn = self.conn.lock().await;
        let mut stmt = conn.prepare(
            r#"SELECT id, download_id, chunk_index, start_byte, end_byte,
                      downloaded_bytes, status, etag, last_modified, created_at, updated_at
               FROM download_chunks WHERE download_id = ? ORDER BY chunk_index ASC"#,
        )?;

        let iter = stmt.query_map(params![download_id], |row| {
            let created_str: String = row.get(9)?;
            let updated_str: String = row.get(10)?;
            Ok(DownloadChunk {
                id: row.get(0)?,
                download_id: row.get(1)?,
                chunk_index: row.get(2)?,
                start_byte: row.get(3)?,
                end_byte: row.get(4)?,
                downloaded_bytes: row.get(5)?,
                status: row.get(6)?,
                etag: row.get(7)?,
                last_modified: row.get(8)?,
                created_at: DateTime::parse_from_rfc3339(&created_str)
                    .map(|t| t.with_timezone(&Utc))
                    .unwrap_or_else(|_| Utc::now()),
                updated_at: DateTime::parse_from_rfc3339(&updated_str)
                    .map(|t| t.with_timezone(&Utc))
                    .unwrap_or_else(|_| Utc::now()),
            })
        })?;

        let mut list = Vec::new();
        for item in iter {
            list.push(item?);
        }
        Ok(list)
    }

    pub async fn update_chunk_progress(
        &self,
        chunk_id: &str,
        downloaded_bytes: i64,
        status: &str,
    ) -> AppResult<()> {
        let conn = self.conn.lock().await;
        let now = Utc::now().to_rfc3339();
        conn.execute(
            "UPDATE download_chunks SET downloaded_bytes = ?, status = ?, updated_at = ? WHERE id = ?",
            params![downloaded_bytes, status, now, chunk_id],
        )?;
        Ok(())
    }

    pub async fn delete_chunks_for_download(&self, download_id: &str) -> AppResult<()> {
        let conn = self.conn.lock().await;
        conn.execute("DELETE FROM download_chunks WHERE download_id = ?", params![download_id])?;
        Ok(())
    }

    // --- Settings KV ---
    pub async fn get_setting(&self, key: &str) -> AppResult<Option<String>> {
        let conn = self.conn.lock().await;
        let mut stmt = conn.prepare("SELECT value FROM settings WHERE key = ?")?;
        let res = stmt.query_row(params![key], |r| r.get(0)).optional()?;
        Ok(res)
    }

    pub async fn set_setting(&self, key: &str, value: &str) -> AppResult<()> {
        let conn = self.conn.lock().await;
        let now = Utc::now().to_rfc3339();
        conn.execute(
            "INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, ?)",
            params![key, value, now],
        )?;
        Ok(())
    }

    // --- History ---
    pub async fn add_history(&self, history: &DownloadHistory) -> AppResult<()> {
        let conn = self.conn.lock().await;
        conn.execute(
            "INSERT INTO download_history (id, download_id, action, metadata, created_at) VALUES (?, ?, ?, ?, ?)",
            params![
                history.id,
                history.download_id,
                history.action,
                history.metadata,
                history.created_at.to_rfc3339()
            ],
        )?;
        Ok(())
    }

    pub async fn get_history(&self, download_id: Option<&str>) -> AppResult<Vec<DownloadHistory>> {
        let conn = self.conn.lock().await;
        let mut list = Vec::new();
        if let Some(dl_id) = download_id {
            let mut stmt = conn.prepare(
                "SELECT id, download_id, action, metadata, created_at FROM download_history WHERE download_id = ? ORDER BY created_at DESC",
            )?;
            let iter = stmt.query_map(params![dl_id], |row| {
                let c_str: String = row.get(4)?;
                Ok(DownloadHistory {
                    id: row.get(0)?,
                    download_id: row.get(1)?,
                    action: row.get(2)?,
                    metadata: row.get(3)?,
                    created_at: DateTime::parse_from_rfc3339(&c_str)
                        .map(|t| t.with_timezone(&Utc))
                        .unwrap_or_else(|_| Utc::now()),
                })
            })?;
            for item in iter {
                list.push(item?);
            }
        } else {
            let mut stmt = conn.prepare(
                "SELECT id, download_id, action, metadata, created_at FROM download_history ORDER BY created_at DESC LIMIT 100",
            )?;
            let iter = stmt.query_map([], |row| {
                let c_str: String = row.get(4)?;
                Ok(DownloadHistory {
                    id: row.get(0)?,
                    download_id: row.get(1)?,
                    action: row.get(2)?,
                    metadata: row.get(3)?,
                    created_at: DateTime::parse_from_rfc3339(&c_str)
                        .map(|t| t.with_timezone(&Utc))
                        .unwrap_or_else(|_| Utc::now()),
                })
            })?;
            for item in iter {
                list.push(item?);
            }
        }
        Ok(list)
    }

    // --- Startup Recovery ---
    pub async fn recover_interrupted_downloads(&self) -> AppResult<Vec<String>> {
        let conn = self.conn.lock().await;
        let now = Utc::now().to_rfc3339();
        
        let mut stmt = conn.prepare(
            "SELECT id FROM downloads WHERE status IN ('downloading', 'merging', 'processing')",
        )?;
        let ids: Vec<String> = stmt
            .query_map([], |row| row.get(0))?
            .filter_map(|r| r.ok())
            .collect();

        if !ids.is_empty() {
            conn.execute(
                "UPDATE downloads SET status = 'paused', speed = 0, eta = 0, active_connections = 0, updated_at = ? WHERE status IN ('downloading', 'merging', 'processing')",
                params![now],
            )?;
        }

        Ok(ids)
    }

    // --- Queues CRUD ---
    pub async fn get_queues(&self) -> AppResult<Vec<Queue>> {
        let conn = self.conn.lock().await;
        let mut stmt = conn.prepare("SELECT id, name, max_concurrent_downloads, is_active, created_at FROM queues")?;
        let iter = stmt.query_map([], |row| {
            let created_str: String = row.get(4)?;
            let is_active_int: i64 = row.get(3)?;
            Ok(Queue {
                id: row.get(0)?,
                name: row.get(1)?,
                max_concurrent_downloads: row.get(2)?,
                is_active: is_active_int != 0,
                created_at: DateTime::parse_from_rfc3339(&created_str)
                    .map(|t| t.with_timezone(&Utc))
                    .unwrap_or_else(|_| Utc::now()),
            })
        })?;

        let mut list = Vec::new();
        for item in iter {
            list.push(item?);
        }
        Ok(list)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    #[tokio::test]
    async fn test_database_init() {
        let conn = Connection::open_in_memory().expect("in-memory db open failed");
        let db = Database::new(conn);
        db.init().await.expect("db.init failed");

        let queues = db.get_queues().await.expect("get_queues failed");
        assert_eq!(queues.len(), 1);
        assert_eq!(queues[0].id, "general");
    }
}
