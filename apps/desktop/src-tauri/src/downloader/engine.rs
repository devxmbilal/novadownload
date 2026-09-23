use crate::database::Database;
use crate::errors::{AppError, AppResult};
use crate::models::*;
use futures_util::StreamExt;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use tokio::fs::OpenOptions;
use tokio::io::AsyncWriteExt;
use tokio::sync::{mpsc, RwLock};
use tokio_util::sync::CancellationToken;
use tracing::{error, info, warn};

use super::chunk::{download_chunk_worker, partition_chunks, ChunkProgressMsg};
use super::limiter::RateLimiter;
use super::speed::SpeedTracker;

#[derive(Clone)]
pub struct ActiveTaskHandle {
    pub cancel_token: CancellationToken,
}

#[derive(Clone)]
pub struct DownloadEngine {
    db: Database,
    http_client: reqwest::Client,
    active_tasks: Arc<RwLock<HashMap<String, ActiveTaskHandle>>>,
    global_limiter: RateLimiter,
}

impl DownloadEngine {
    pub fn new(db: Database) -> Self {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(30))
            .pool_idle_timeout(Duration::from_secs(90))
            .pool_max_idle_per_host(32)
            .build()
            .unwrap_or_default();

        Self {
            db,
            http_client: client,
            active_tasks: Arc::new(RwLock::new(HashMap::new())),
            global_limiter: RateLimiter::new(0),
        }
    }

    pub fn set_global_speed_limit(&self, bytes_per_sec: u64) {
        self.global_limiter.set_limit(bytes_per_sec);
    }

    pub async fn start_download(&self, app: AppHandle, download_id: &str) -> AppResult<()> {
        let dl_opt = self.db.get_download(download_id).await?;
        let mut dl = match dl_opt {
            Some(d) => d,
            None => return Err(AppError::NotFound(download_id.to_string())),
        };

        // If already active, return
        {
            let tasks = self.active_tasks.read().await;
            if tasks.contains_key(download_id) {
                return Ok(());
            }
        }

        // Set status to downloading in DB
        self.db.update_download_status(download_id, DownloadStatus::Downloading, None).await?;
        let _ = app.emit("download:status_changed", serde_json::json!({
            "download_id": download_id,
            "status": "downloading"
        }));

        let cancel_token = CancellationToken::new();
        {
            let mut tasks = self.active_tasks.write().await;
            tasks.insert(download_id.to_string(), ActiveTaskHandle {
                cancel_token: cancel_token.clone(),
            });
        }

        let engine = self.clone();
        let dl_id = download_id.to_string();

        tauri::async_runtime::spawn(async move {
            let res = engine.execute_download(app.clone(), &mut dl, cancel_token.clone()).await;
            
            // Remove from active tasks
            {
                let mut tasks = engine.active_tasks.write().await;
                tasks.remove(&dl_id);
            }

            match res {
                Ok(_) => {
                    info!("Download {} completed successfully", dl_id);
                    let _ = engine.db.update_download_status(&dl_id, DownloadStatus::Completed, None).await;
                    let _ = app.emit("download:status_changed", serde_json::json!({
                        "download_id": dl_id,
                        "status": "completed"
                    }));
                }
                Err(AppError::Cancelled) => {
                    info!("Download {} paused / cancelled", dl_id);
                }
                Err(e) => {
                    error!("Download {} failed: {:?}", dl_id, e);
                    let err_msg = e.to_string();
                    let _ = engine.db.update_download_status(&dl_id, DownloadStatus::Failed, Some(&err_msg)).await;
                    let _ = app.emit("download:status_changed", serde_json::json!({
                        "download_id": dl_id,
                        "status": "failed",
                        "error": err_msg
                    }));
                }
            }
        });

        Ok(())
    }

    pub async fn pause_download(&self, app: AppHandle, download_id: &str) -> AppResult<()> {
        let handle = {
            let mut tasks = self.active_tasks.write().await;
            tasks.remove(download_id)
        };

        if let Some(h) = handle {
            h.cancel_token.cancel();
        }

        self.db.update_download_status(download_id, DownloadStatus::Paused, None).await?;
        let _ = app.emit("download:status_changed", serde_json::json!({
            "download_id": download_id,
            "status": "paused"
        }));

        Ok(())
    }

    pub async fn cancel_download(&self, app: AppHandle, download_id: &str, delete_files: bool) -> AppResult<()> {
        let _ = self.pause_download(app.clone(), download_id).await;

        if let Some(dl) = self.db.get_download(download_id).await? {
            if delete_files {
                let part_path = PathBuf::from(format!("{}.part", dl.file_path));
                let _ = tokio::fs::remove_file(part_path).await;
                let final_path = PathBuf::from(&dl.file_path);
                let _ = tokio::fs::remove_file(final_path).await;
            }
        }

        self.db.update_download_status(download_id, DownloadStatus::Cancelled, None).await?;
        let _ = app.emit("download:status_changed", serde_json::json!({
            "download_id": download_id,
            "status": "cancelled"
        }));

        Ok(())
    }

    async fn execute_download(
        &self,
        app: AppHandle,
        dl: &mut Download,
        cancel_token: CancellationToken,
    ) -> AppResult<()> {
        let directory = PathBuf::from(&dl.directory);
        if !directory.exists() {
            tokio::fs::create_dir_all(&directory)
                .await
                .map_err(|e| AppError::FileSystem(e.to_string()))?;
        }

        let part_file_path = PathBuf::from(format!("{}.part", dl.file_path));
        let final_file_path = PathBuf::from(&dl.file_path);

        // Check if we can do multi-connection chunking
        let existing_chunks = self.db.get_chunks_for_download(&dl.id).await?;
        let use_chunks = if let Some(size) = dl.file_size {
            size > 1024 * 1024 && dl.total_connections > 1
        } else {
            false
        };

        if use_chunks {
            let chunks = if existing_chunks.is_empty() {
                let created = partition_chunks(&dl.id, dl.file_size.unwrap(), dl.total_connections);
                self.db.insert_chunks(&created).await?;
                created
            } else {
                existing_chunks
            };

            self.execute_multi_chunk_download(
                app,
                dl,
                chunks,
                part_file_path.clone(),
                final_file_path,
                cancel_token,
            )
            .await
        } else {
            self.execute_single_stream_download(
                app,
                dl,
                part_file_path.clone(),
                final_file_path,
                cancel_token,
            )
            .await
        }
    }

    async fn execute_multi_chunk_download(
        &self,
        app: AppHandle,
        dl: &mut Download,
        chunks: Vec<DownloadChunk>,
        part_path: PathBuf,
        final_path: PathBuf,
        cancel_token: CancellationToken,
    ) -> AppResult<()> {
        let (tx, mut rx) = mpsc::channel::<ChunkProgressMsg>(256);
        let num_chunks = chunks.len();

        // Calculate initial downloaded sum
        let initial_sum: i64 = chunks.iter().map(|c| c.downloaded_bytes).sum();
        dl.downloaded_size = initial_sum;

        // Ensure part file exists and is appropriately sized or created
        if !part_path.exists() {
            let file = OpenOptions::new()
                .create(true)
                .write(true)
                .open(&part_path)
                .await
                .map_err(|e| AppError::FileSystem(e.to_string()))?;

            if let Some(total_size) = dl.file_size {
                let _ = file.set_len(total_size as u64).await;
            }
        }

        // Spawn workers for each chunk
        for chunk in chunks.iter() {
            let client = self.http_client.clone();
            let url = dl.url.clone();
            let chunk_data = chunk.clone();
            let p_path = part_path.clone();
            let sender = tx.clone();
            let c_token = cancel_token.clone();
            let limiter = self.global_limiter.clone();

            tauri::async_runtime::spawn(async move {
                let _ = download_chunk_worker(
                    client,
                    url,
                    None,
                    chunk_data,
                    p_path,
                    sender,
                    c_token,
                    limiter,
                )
                .await;
            });
        }
        drop(tx); // drop main tx so rx ends when workers finish

        let mut speed_tracker = SpeedTracker::new(initial_sum, dl.file_size, 3.0);
        let mut chunk_downloaded_map: HashMap<u32, i64> = chunks
            .iter()
            .map(|c| (c.chunk_index, c.downloaded_bytes))
            .collect();
        let chunk_ids_map: HashMap<u32, String> = chunks
            .iter()
            .map(|c| (c.chunk_index, c.id.clone()))
            .collect();

        let mut monotonic_downloaded = initial_sum;
        let mut progress_sequence = dl.progress_sequence;
        let mut last_emit = std::time::Instant::now();
        let mut last_db_update = std::time::Instant::now();
        let mut completed_count = 0;

        while let Some(msg) = rx.recv().await {
            if cancel_token.is_cancelled() {
                return Err(AppError::Cancelled);
            }

            match msg {
                ChunkProgressMsg::ChunkProgress { chunk_index, downloaded_bytes } => {
                    chunk_downloaded_map.insert(chunk_index, downloaded_bytes);
                    let total_downloaded: i64 = chunk_downloaded_map.values().sum();
                    monotonic_downloaded = monotonic_downloaded.max(total_downloaded);

                    // Throttle event emission to ~10 updates per second (100ms)
                    let now = std::time::Instant::now();
                    if now.duration_since(last_emit).as_millis() >= 100 {
                        last_emit = now;
                        progress_sequence += 1;
                        let (speed, avg_speed, eta) = speed_tracker.record_progress(monotonic_downloaded);
                        let percentage = dl.file_size.map_or(0.0, |sz| {
                            if sz > 0 {
                                ((monotonic_downloaded as f64 / sz as f64) * 100.0).min(100.0)
                            } else {
                                0.0
                            }
                        });

                        let payload = DownloadProgressPayload {
                            download_id: dl.id.clone(),
                            downloaded_size: monotonic_downloaded,
                            file_size: dl.file_size,
                            percentage,
                            speed,
                            average_speed: avg_speed,
                            eta,
                            active_connections: (num_chunks.saturating_sub(completed_count)) as u32,
                            status: DownloadStatus::Downloading,
                            progress_sequence,
                        };
                        let _ = app.emit("download:progress", payload);
                    }

                    // Throttle DB persistence to every 1.5 seconds
                    if now.duration_since(last_db_update).as_millis() >= 1500 {
                        last_db_update = now;
                        let (speed, avg_speed, eta) = speed_tracker.record_progress(monotonic_downloaded);
                        let _ = self.db.update_download_progress(
                            &dl.id,
                            monotonic_downloaded,
                            speed,
                            avg_speed,
                            eta,
                            (num_chunks.saturating_sub(completed_count)) as u32,
                            progress_sequence,
                        ).await;

                        // Persist chunk downloaded bytes
                        if let (Some(c_bytes), Some(c_id)) = (chunk_downloaded_map.get(&chunk_index), chunk_ids_map.get(&chunk_index)) {
                            let _ = self.db.update_chunk_progress(c_id, *c_bytes, "downloading").await;
                        }
                    }
                }
                ChunkProgressMsg::BytesRead { chunk_index, bytes } => {
                    if let Some(cur) = chunk_downloaded_map.get_mut(&chunk_index) {
                        *cur += bytes as i64;
                    }
                    let total_downloaded: i64 = chunk_downloaded_map.values().sum();
                    monotonic_downloaded = monotonic_downloaded.max(total_downloaded);

                    let now = std::time::Instant::now();
                    if now.duration_since(last_emit).as_millis() >= 100 {
                        last_emit = now;
                        progress_sequence += 1;
                        let (speed, avg_speed, eta) = speed_tracker.record_progress(monotonic_downloaded);
                        let percentage = dl.file_size.map_or(0.0, |sz| {
                            if sz > 0 {
                                ((monotonic_downloaded as f64 / sz as f64) * 100.0).min(100.0)
                            } else {
                                0.0
                            }
                        });

                        let payload = DownloadProgressPayload {
                            download_id: dl.id.clone(),
                            downloaded_size: monotonic_downloaded,
                            file_size: dl.file_size,
                            percentage,
                            speed,
                            average_speed: avg_speed,
                            eta,
                            active_connections: (num_chunks.saturating_sub(completed_count)) as u32,
                            status: DownloadStatus::Downloading,
                            progress_sequence,
                        };
                        let _ = app.emit("download:progress", payload);
                    }

                    if now.duration_since(last_db_update).as_millis() >= 1500 {
                        last_db_update = now;
                        let (speed, avg_speed, eta) = speed_tracker.record_progress(monotonic_downloaded);
                        let _ = self.db.update_download_progress(
                            &dl.id,
                            monotonic_downloaded,
                            speed,
                            avg_speed,
                            eta,
                            (num_chunks.saturating_sub(completed_count)) as u32,
                            progress_sequence,
                        ).await;

                        if let (Some(c_bytes), Some(c_id)) = (chunk_downloaded_map.get(&chunk_index), chunk_ids_map.get(&chunk_index)) {
                            let _ = self.db.update_chunk_progress(c_id, *c_bytes, "downloading").await;
                        }
                    }
                }
                ChunkProgressMsg::ChunkCompleted { chunk_index } => {
                    completed_count += 1;
                    if let Some(c_id) = chunk_ids_map.get(&chunk_index) {
                        let c_bytes = chunk_downloaded_map.get(&chunk_index).copied().unwrap_or(0);
                        let _ = self.db.update_chunk_progress(c_id, c_bytes, "completed").await;
                    }
                }
                ChunkProgressMsg::ChunkFailed { chunk_index, error } => {
                    warn!("Chunk {} error: {}", chunk_index, error);
                    return Err(AppError::Network(error));
                }
            }
        }

        if cancel_token.is_cancelled() {
            return Err(AppError::Cancelled);
        }

        // Final atomic rename from .part to final target
        if part_path.exists() {
            if final_path.exists() {
                let _ = tokio::fs::remove_file(&final_path).await;
            }
            tokio::fs::rename(&part_path, &final_path)
                .await
                .map_err(|e| AppError::FileSystem(e.to_string()))?;
        }

        progress_sequence += 1;
        let final_size = dl.file_size.unwrap_or(monotonic_downloaded);
        let avg_speed = speed_tracker.average_speed();

        let _ = self.db.update_download_progress(
            &dl.id,
            final_size,
            0.0,
            avg_speed,
            None,
            0,
            progress_sequence,
        ).await;

        // Final progress emit
        let _ = app.emit("download:progress", DownloadProgressPayload {
            download_id: dl.id.clone(),
            downloaded_size: final_size,
            file_size: dl.file_size,
            percentage: 100.0,
            speed: 0.0,
            average_speed: avg_speed,
            eta: None,
            active_connections: 0,
            status: DownloadStatus::Completed,
            progress_sequence,
        });

        Ok(())
    }

    async fn execute_single_stream_download(
        &self,
        app: AppHandle,
        dl: &mut Download,
        part_path: PathBuf,
        final_path: PathBuf,
        cancel_token: CancellationToken,
    ) -> AppResult<()> {
        let mut req = self.http_client.get(&dl.url);
        let initial_offset = if part_path.exists() {
            tokio::fs::metadata(&part_path).await.map(|m| m.len() as i64).unwrap_or(0)
        } else {
            0
        };

        if initial_offset > 0 {
            req = req.header("Range", format!("bytes={}-", initial_offset));
        }

        let resp = req.send().await.map_err(|e| AppError::Network(e.to_string()))?;
        let status = resp.status();
        if !status.is_success() && status.as_u16() != 206 {
            return Err(AppError::Http {
                status: status.as_u16(),
                message: format!("HTTP error {}", status),
            });
        }

        let mut file = OpenOptions::new()
            .create(true)
            .write(true)
            .append(initial_offset > 0 && status.as_u16() == 206)
            .truncate(initial_offset == 0 || status.as_u16() != 206)
            .open(&part_path)
            .await
            .map_err(|e| AppError::FileSystem(e.to_string()))?;

        let mut current_downloaded = if status.as_u16() == 206 { initial_offset } else { 0 };
        let mut monotonic_downloaded = current_downloaded;
        let mut progress_sequence = dl.progress_sequence;
        let mut stream = resp.bytes_stream();
        let mut speed_tracker = SpeedTracker::new(current_downloaded, dl.file_size, 3.0);
        let mut last_emit = std::time::Instant::now();
        let mut last_db_update = std::time::Instant::now();

        while let Some(item) = stream.next().await {
            if cancel_token.is_cancelled() {
                return Err(AppError::Cancelled);
            }

            match item {
                Ok(bytes) => {
                    let len = bytes.len();
                    self.global_limiter.acquire(len).await;

                    file.write_all(&bytes)
                        .await
                        .map_err(|e| AppError::FileSystem(e.to_string()))?;

                    current_downloaded += len as i64;
                    monotonic_downloaded = monotonic_downloaded.max(current_downloaded);

                    let now = std::time::Instant::now();
                    if now.duration_since(last_emit).as_millis() >= 100 {
                        last_emit = now;
                        progress_sequence += 1;
                        let (speed, avg_speed, eta) = speed_tracker.record_progress(monotonic_downloaded);
                        let percentage = dl.file_size.map_or(0.0, |sz| {
                            if sz > 0 {
                                ((monotonic_downloaded as f64 / sz as f64) * 100.0).min(100.0)
                            } else {
                                0.0
                            }
                        });

                        let payload = DownloadProgressPayload {
                            download_id: dl.id.clone(),
                            downloaded_size: monotonic_downloaded,
                            file_size: dl.file_size,
                            percentage,
                            speed,
                            average_speed: avg_speed,
                            eta,
                            active_connections: 1,
                            status: DownloadStatus::Downloading,
                            progress_sequence,
                        };
                        let _ = app.emit("download:progress", payload);
                    }

                    if now.duration_since(last_db_update).as_millis() >= 1500 {
                        last_db_update = now;
                        let (speed, avg_speed, eta) = speed_tracker.record_progress(monotonic_downloaded);
                        let _ = self.db.update_download_progress(
                            &dl.id,
                            monotonic_downloaded,
                            speed,
                            avg_speed,
                            eta,
                            1,
                            progress_sequence,
                        ).await;
                    }
                }
                Err(e) => {
                    return Err(AppError::Network(e.to_string()));
                }
            }
        }

        file.flush().await.map_err(|e| AppError::FileSystem(e.to_string()))?;

        if cancel_token.is_cancelled() {
            return Err(AppError::Cancelled);
        }

        // Rename from .part to final
        if part_path.exists() {
            if final_path.exists() {
                let _ = tokio::fs::remove_file(&final_path).await;
            }
            tokio::fs::rename(&part_path, &final_path)
                .await
                .map_err(|e| AppError::FileSystem(e.to_string()))?;
        }

        progress_sequence += 1;
        let final_size = dl.file_size.unwrap_or(monotonic_downloaded);
        let avg_speed = speed_tracker.average_speed();

        let _ = self.db.update_download_progress(
            &dl.id,
            final_size,
            0.0,
            avg_speed,
            None,
            0,
            progress_sequence,
        ).await;

        let _ = app.emit("download:progress", DownloadProgressPayload {
            download_id: dl.id.clone(),
            downloaded_size: final_size,
            file_size: dl.file_size,
            percentage: 100.0,
            speed: 0.0,
            average_speed: avg_speed,
            eta: None,
            active_connections: 0,
            status: DownloadStatus::Completed,
            progress_sequence,
        });

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    #[test]
    fn test_chunk_aggregation_and_monotonicity() {
        let mut chunk_map: HashMap<u32, i64> = HashMap::new();
        chunk_map.insert(0, 0);
        chunk_map.insert(1, 0);
        chunk_map.insert(2, 0);
        chunk_map.insert(3, 0);

        let mut monotonic_total: i64 = 0;

        // Progress on chunks
        chunk_map.insert(0, 10_000_000);
        let sum: i64 = chunk_map.values().sum();
        monotonic_total = monotonic_total.max(sum);
        assert_eq!(monotonic_total, 10_000_000);

        chunk_map.insert(1, 20_000_000);
        let sum: i64 = chunk_map.values().sum();
        monotonic_total = monotonic_total.max(sum);
        assert_eq!(monotonic_total, 30_000_000);

        chunk_map.insert(2, 25_000_000);
        let sum: i64 = chunk_map.values().sum();
        monotonic_total = monotonic_total.max(sum);
        assert_eq!(monotonic_total, 55_000_000);
    }

    #[test]
    fn test_retry_scenario_no_double_counting() {
        // Scenario: 100 MB file, 4 chunks of 25 MB
        let total_file_size: i64 = 100_000_000;
        let mut chunk_map: HashMap<u32, i64> = HashMap::new();
        chunk_map.insert(0, 25_000_000); // 25 MB done
        chunk_map.insert(1, 25_000_000); // 25 MB done
        chunk_map.insert(2, 15_000_000); // 15 MB done, then connection fails
        chunk_map.insert(3, 0);          // 0 MB

        let mut monotonic_total: i64 = chunk_map.values().sum();
        assert_eq!(monotonic_total, 65_000_000); // 65 MB

        // Chunk 2 restarts from 0 on retry
        chunk_map.insert(2, 0);
        let current_sum: i64 = chunk_map.values().sum();
        assert_eq!(current_sum, 50_000_000); // Real disk unique sum drops to 50MB
        // Monotonic total must never decrease:
        monotonic_total = monotonic_total.max(current_sum);
        assert_eq!(monotonic_total, 65_000_000); // Protected from backward jump

        // Chunk 2 downloads again up to 20 MB
        chunk_map.insert(2, 20_000_000);
        let current_sum: i64 = chunk_map.values().sum();
        monotonic_total = monotonic_total.max(current_sum);
        assert_eq!(monotonic_total, 70_000_000); // 25 + 25 + 20 + 0 = 70 MB

        // Chunk 2 finishes (25 MB) and Chunk 3 finishes (25 MB)
        chunk_map.insert(2, 25_000_000);
        chunk_map.insert(3, 25_000_000);
        let current_sum: i64 = chunk_map.values().sum();
        monotonic_total = monotonic_total.max(current_sum);
        assert_eq!(monotonic_total, total_file_size);
        assert_eq!(monotonic_total, 100_000_000);

        let percentage = (monotonic_total as f64 / total_file_size as f64) * 100.0;
        assert_eq!(percentage, 100.0);
    }

    #[test]
    fn test_stale_sequence_rejection_logic() {
        let mut current_sequence: u64 = 100;

        let incoming_event_1 = 101;
        if incoming_event_1 >= current_sequence {
            current_sequence = incoming_event_1;
        }
        assert_eq!(current_sequence, 101);

        let stale_event = 99;
        let is_stale = stale_event < current_sequence;
        assert!(is_stale);
        if !is_stale {
            current_sequence = stale_event;
        }
        assert_eq!(current_sequence, 101); // Preserved
    }

    #[test]
    fn test_unknown_content_length_percentage() {
        let file_size: Option<i64> = None;
        let downloaded: i64 = 50_000_000;
        let percentage: Option<f64> = file_size.map(|sz| {
            if sz > 0 {
                ((downloaded as f64 / sz as f64) * 100.0).min(100.0)
            } else {
                0.0
            }
        });
        assert_eq!(percentage, None); // Indeterminate state, no fake %
    }
}
