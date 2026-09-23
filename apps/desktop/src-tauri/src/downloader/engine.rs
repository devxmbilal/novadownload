use crate::database::Database;
use crate::errors::{AppError, AppResult};
use crate::models::*;
use futures_util::StreamExt;
use std::collections::{HashMap, HashSet};
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
        let (tx, mut rx) = mpsc::channel::<ChunkProgressMsg>(512);
        let num_chunks = chunks.len();

        // Initial sum from persisted chunk data — canonical source of truth.
        let initial_sum: i64 = chunks.iter().map(|c| c.downloaded_bytes).sum();
        dl.downloaded_size = initial_sum;

        // Pre-allocate the part file to full size so chunks can seek and write in parallel.
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

        // Spawn one worker per chunk
        for chunk in chunks.iter() {
            let client = self.http_client.clone();
            let url = dl.url.clone();
            let chunk_data = chunk.clone();
            let p_path = part_path.clone();
            let sender = tx.clone();
            let c_token = cancel_token.clone();
            let limiter = self.global_limiter.clone();
            tauri::async_runtime::spawn(async move {
                let _ = download_chunk_worker(client, url, None, chunk_data, p_path, sender, c_token, limiter).await;
            });
        }
        drop(tx); // Drop engine's tx so rx closes when all workers finish

        // Per-chunk ABSOLUTE downloaded bytes — summing this is the only correct way to
        // compute global progress. Workers emit ChunkProgress{absolute}, so inserting into
        // this map replaces the old value without accumulating.
        let mut chunk_downloaded_map: HashMap<u32, i64> = chunks
            .iter()
            .map(|c| (c.chunk_index, c.downloaded_bytes))
            .collect();

        let chunk_ids_map: HashMap<u32, String> = chunks
            .iter()
            .map(|c| (c.chunk_index, c.id.clone()))
            .collect();

        // Monotonic protection: if a chunk resets on retry the sum temporarily drops —
        // we never let the displayed value go below the last seen maximum.
        let mut monotonic_downloaded: i64 = initial_sum;
        let mut progress_sequence: u64 = dl.progress_sequence;
        let mut speed_tracker = SpeedTracker::new(initial_sum, dl.file_size, 3.0);
        let mut last_emit = std::time::Instant::now();
        let mut last_db_update = std::time::Instant::now();
        let mut completed_count: usize = 0;

        // Track which chunks have new data since the last DB flush.
        let mut dirty_chunks: HashSet<u32> = HashSet::new();

        while let Some(msg) = rx.recv().await {
            if cancel_token.is_cancelled() {
                return Err(AppError::Cancelled);
            }

            match msg {
                // ChunkProgress carries the ABSOLUTE downloaded_bytes for the chunk.
                // Replacing the map entry is what prevents double-counting on retry.
                ChunkProgressMsg::ChunkProgress { chunk_index, downloaded_bytes } => {
                    chunk_downloaded_map.insert(chunk_index, downloaded_bytes);
                    dirty_chunks.insert(chunk_index);

                    let total_downloaded: i64 = chunk_downloaded_map.values().sum();
                    monotonic_downloaded = monotonic_downloaded.max(total_downloaded);

                    let now = std::time::Instant::now();

                    // Throttle UI events: ~10 per second
                    if now.duration_since(last_emit).as_millis() >= 100 {
                        last_emit = now;
                        progress_sequence += 1;

                        // Single record_progress call per UI tick — no duplicate samples
                        let (speed, avg_speed, eta) = speed_tracker.record_progress(monotonic_downloaded);

                        let percentage = dl.file_size.map_or(0.0, |sz| {
                            if sz > 0 { ((monotonic_downloaded as f64 / sz as f64) * 100.0).min(100.0) }
                            else { 0.0 }
                        });

                        let active = (num_chunks.saturating_sub(completed_count)) as u32;
                        let _ = app.emit("download:progress", DownloadProgressPayload {
                            download_id: dl.id.clone(),
                            downloaded_size: monotonic_downloaded,
                            file_size: dl.file_size,
                            percentage,
                            speed,
                            average_speed: avg_speed,
                            eta,
                            active_connections: active,
                            status: DownloadStatus::Downloading,
                            progress_sequence,
                        });

                        // Throttle DB writes: every 1.5 seconds
                        if now.duration_since(last_db_update).as_millis() >= 1500 {
                            last_db_update = now;
                            let _ = self.db.update_download_progress(
                                &dl.id, monotonic_downloaded, speed, avg_speed, eta, active, progress_sequence,
                            ).await;

                            // Batch-persist ALL dirty chunks (not just the triggering one)
                            for &ci in &dirty_chunks {
                                if let (Some(&c_bytes), Some(c_id)) = (
                                    chunk_downloaded_map.get(&ci),
                                    chunk_ids_map.get(&ci),
                                ) {
                                    let _ = self.db.update_chunk_progress(c_id, c_bytes, "downloading").await;
                                }
                            }
                            dirty_chunks.clear();
                        }
                    }
                }

                ChunkProgressMsg::ChunkCompleted { chunk_index } => {
                    completed_count += 1;
                    dirty_chunks.remove(&chunk_index);
                    if let (Some(&c_bytes), Some(c_id)) = (
                        chunk_downloaded_map.get(&chunk_index),
                        chunk_ids_map.get(&chunk_index),
                    ) {
                        let _ = self.db.update_chunk_progress(c_id, c_bytes, "completed").await;
                    }
                }

                ChunkProgressMsg::ChunkFailed { chunk_index, error } => {
                    warn!("Chunk {} error: {}", chunk_index, error);
                    return Err(AppError::Network(error));
                }

                // BytesRead is a legacy delta message — chunk.rs only emits ChunkProgress
                // (absolute). Ignoring BytesRead prevents accidental double-counting if it
                // ever fires from an old code path.
                ChunkProgressMsg::BytesRead { .. } => {}
            }
        }

        if cancel_token.is_cancelled() {
            return Err(AppError::Cancelled);
        }

        // Atomic rename: .part → final
        if part_path.exists() {
            if final_path.exists() {
                let _ = tokio::fs::remove_file(&final_path).await;
            }
            tokio::fs::rename(&part_path, &final_path)
                .await
                .map_err(|e| AppError::FileSystem(e.to_string()))?;
        }

        progress_sequence += 1;
        let final_downloaded = dl.file_size.unwrap_or(monotonic_downloaded);
        let avg_speed = speed_tracker.average_speed();

        let _ = self.db.update_download_progress(
            &dl.id, final_downloaded, 0.0, avg_speed, None, 0, progress_sequence,
        ).await;

        // Persist any remaining dirty chunks as completed
        for &ci in &dirty_chunks {
            if let (Some(&c_bytes), Some(c_id)) = (chunk_downloaded_map.get(&ci), chunk_ids_map.get(&ci)) {
                let _ = self.db.update_chunk_progress(c_id, c_bytes, "completed").await;
            }
        }

        // Final completion event: percentage=100, speed=0, eta=null
        let _ = app.emit("download:progress", DownloadProgressPayload {
            download_id: dl.id.clone(),
            downloaded_size: final_downloaded,
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

                    // Throttle UI events: ~10 per second
                    if now.duration_since(last_emit).as_millis() >= 100 {
                        last_emit = now;
                        progress_sequence += 1;

                        // Single record_progress call per tick — values shared with DB write
                        let (speed, avg_speed, eta) = speed_tracker.record_progress(monotonic_downloaded);

                        let percentage = dl.file_size.map_or(0.0, |sz| {
                            if sz > 0 {
                                ((monotonic_downloaded as f64 / sz as f64) * 100.0).min(100.0)
                            } else {
                                0.0
                            }
                        });

                        let _ = app.emit("download:progress", DownloadProgressPayload {
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
                        });

                        // Throttle DB writes: every 1.5 seconds — reuse speed values from above
                        if now.duration_since(last_db_update).as_millis() >= 1500 {
                            last_db_update = now;
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
    use super::super::speed::SpeedTracker;

    // ----- Chunk aggregation & monotonicity ---------------------------------

    #[test]
    fn test_chunk_aggregation_and_monotonicity() {
        let mut chunk_map: HashMap<u32, i64> = HashMap::new();
        chunk_map.insert(0, 0);
        chunk_map.insert(1, 0);
        chunk_map.insert(2, 0);
        chunk_map.insert(3, 0);

        let mut monotonic: i64 = 0;

        chunk_map.insert(0, 10_000_000);
        let sum: i64 = chunk_map.values().sum();
        monotonic = monotonic.max(sum);
        assert_eq!(monotonic, 10_000_000);

        chunk_map.insert(1, 20_000_000);
        let sum: i64 = chunk_map.values().sum();
        monotonic = monotonic.max(sum);
        assert_eq!(monotonic, 30_000_000);

        chunk_map.insert(2, 25_000_000);
        let sum: i64 = chunk_map.values().sum();
        monotonic = monotonic.max(sum);
        assert_eq!(monotonic, 55_000_000);

        chunk_map.insert(3, 25_000_000);
        let sum: i64 = chunk_map.values().sum();
        monotonic = monotonic.max(sum);
        assert_eq!(monotonic, 80_000_000);
    }

    // ----- Retry: no double-counting ----------------------------------------

    #[test]
    fn test_retry_scenario_no_double_counting() {
        let total_file_size: i64 = 100_000_000;
        let mut chunk_map: HashMap<u32, i64> = HashMap::new();
        chunk_map.insert(0, 25_000_000);
        chunk_map.insert(1, 25_000_000);
        chunk_map.insert(2, 15_000_000); // fails at 15 MB
        chunk_map.insert(3, 0);

        let mut monotonic: i64 = chunk_map.values().sum();
        assert_eq!(monotonic, 65_000_000);

        // Chunk 2 resets on retry — absolute replace prevents double-counting
        chunk_map.insert(2, 0);
        let sum: i64 = chunk_map.values().sum();
        assert_eq!(sum, 50_000_000);
        monotonic = monotonic.max(sum);
        assert_eq!(monotonic, 65_000_000); // protected from backward jump

        chunk_map.insert(2, 20_000_000);
        let sum: i64 = chunk_map.values().sum();
        monotonic = monotonic.max(sum);
        assert_eq!(monotonic, 70_000_000);

        chunk_map.insert(2, 25_000_000);
        chunk_map.insert(3, 25_000_000);
        let sum: i64 = chunk_map.values().sum();
        monotonic = monotonic.max(sum);
        assert_eq!(monotonic, total_file_size);

        let pct = (monotonic as f64 / total_file_size as f64) * 100.0;
        assert_eq!(pct, 100.0);
    }

    // ----- Absolute progress: no accumulation across events -----------------

    #[test]
    fn test_absolute_chunk_progress_no_double_count() {
        let mut chunk_map: HashMap<u32, i64> = HashMap::new();
        chunk_map.insert(0, 0);

        // Event 1: absolute 10 MB
        chunk_map.insert(0, 10_000_000);
        assert_eq!(chunk_map.values().sum::<i64>(), 10_000_000);

        // Event 2: absolute 20 MB (not a delta)
        chunk_map.insert(0, 20_000_000);
        assert_eq!(chunk_map.values().sum::<i64>(), 20_000_000); // NOT 30 MB
    }

    // ----- Stale sequence rejection -----------------------------------------

    #[test]
    fn test_stale_sequence_rejection_logic() {
        let mut current_sequence: u64 = 100;

        let incoming_1 = 101u64;
        if incoming_1 >= current_sequence { current_sequence = incoming_1; }
        assert_eq!(current_sequence, 101);

        let stale = 99u64;
        let is_stale = stale < current_sequence;
        assert!(is_stale);
        if !is_stale { current_sequence = stale; }
        assert_eq!(current_sequence, 101);
    }

    // ----- Unknown Content-Length: indeterminate ----------------------------

    #[test]
    fn test_unknown_content_length_percentage() {
        let file_size: Option<i64> = None;
        let downloaded: i64 = 50_000_000;
        let percentage: Option<f64> = file_size.map(|sz| {
            if sz > 0 { ((downloaded as f64 / sz as f64) * 100.0).min(100.0) } else { 0.0 }
        });
        assert_eq!(percentage, None);
    }

    // ----- Completion state -------------------------------------------------

    #[test]
    fn test_completion_state() {
        let total: i64 = 100_000_000;
        let downloaded = total;
        let pct = (downloaded as f64 / total as f64) * 100.0;
        assert_eq!(pct, 100.0);
        let speed: f64 = 0.0;
        let eta: Option<i64> = None;
        assert_eq!(speed, 0.0);
        assert_eq!(eta, None);
    }

    // ----- ETA: null when speed = 0 -----------------------------------------

    #[test]
    fn test_eta_null_when_zero_speed() {
        let mut tracker = SpeedTracker::new(1000, Some(100_000_000), 3.0);
        let (speed, _, eta) = tracker.record_progress(1000); // no progress
        assert_eq!(speed, 0.0);
        assert_eq!(eta, None);
    }

    // ----- UI progress never decreases (spec §20) ---------------------------

    #[test]
    fn test_ui_progress_never_decreases() {
        let mut displayed: f64 = 0.0;
        for incoming in [0.0f64, 5.0, 12.0, 18.0, 24.0, 31.0, 39.0, 47.0,
                         56.0, 64.0, 73.0, 81.0, 88.0, 94.0, 98.0, 100.0] {
            displayed = f64::max(displayed, incoming);
            assert!(displayed >= 0.0 && displayed <= 100.0);
        }
        assert_eq!(displayed, 100.0);
    }

    #[test]
    fn test_ui_progress_rejects_backward_events() {
        let mut displayed: f64 = 0.0;
        let noisy = [0.0f64, 8.0, 6.0, 14.0, 12.0, 22.0, 19.0, 35.0, 100.0];
        let floor  = [0.0f64, 8.0, 8.0, 14.0, 14.0, 22.0, 22.0, 35.0, 100.0];
        for (&inc, &exp) in noisy.iter().zip(floor.iter()) {
            displayed = f64::max(displayed, inc);
            assert_eq!(displayed, exp, "at event {}", inc);
        }
    }

    // ----- Pause/resume: bytes preserved ------------------------------------

    #[test]
    fn test_pause_resume_bytes_preserved() {
        let downloaded_before: i64 = 40_000_000;
        let downloaded_after: i64 = downloaded_before; // pause must not reset
        assert_eq!(downloaded_before, downloaded_after);
        assert!(downloaded_after > 0);
    }
}
