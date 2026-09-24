use crate::downloader::probe_url as engine_probe_url;
use crate::filesystem::{get_unique_filepath, sanitize_filename};
use crate::models::*;
use crate::state::AppState;
use chrono::Utc;
use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Stdio;
use tauri::{AppHandle, Emitter, State};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio_util::sync::CancellationToken;
use tracing::{info, warn};
use uuid::Uuid;

#[tauri::command]
pub async fn probe_url(url: String) -> Result<UrlProbeResult, String> {
    let client = reqwest::Client::new();
    engine_probe_url(&client, &url)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn create_download(
    app: AppHandle,
    state: State<'_, AppState>,
    request: AddDownloadRequest,
) -> Result<Download, String> {
    let settings = state.settings_mgr.get_settings().await;
    let url = request.url.trim().to_string();
    if url.is_empty() {
        return Err("URL cannot be empty".to_string());
    }

    // Determine target directory
    let base_dir = request.directory.unwrap_or(settings.default_download_directory.clone());
    let category = request.category.unwrap_or_else(|| "Other".to_string());
    
    let target_dir = if settings.auto_categorize {
        if let Some(sub) = settings.category_folders.get(&category) {
            PathBuf::from(&base_dir).join(sub)
        } else {
            PathBuf::from(&base_dir)
        }
    } else {
        PathBuf::from(&base_dir)
    };

    // Probe URL if name or size is not provided
    let probe = {
        let client = reqwest::Client::new();
        engine_probe_url(&client, &url).await.ok()
    };

    let filename = request.file_name.unwrap_or_else(|| {
        probe.as_ref()
            .map(|p| p.file_name.clone())
            .unwrap_or_else(|| "download_file".to_string())
    });

    let clean_filename = sanitize_filename(&filename);
    let final_filepath = get_unique_filepath(&target_dir, &clean_filename);

    let file_size = probe.as_ref().and_then(|p| p.file_size);
    let mime_type = probe.as_ref().and_then(|p| p.mime_type.clone());
    let connections = request.connections.unwrap_or(settings.default_connections).min(16).max(1);

    let start_immediately = request.start_immediately.unwrap_or(true);
    let initial_status = if start_immediately {
        DownloadStatus::Pending
    } else {
        DownloadStatus::Queued
    };

    let now = Utc::now();
    let download = Download {
        id: Uuid::new_v4().to_string(),
        url: url.clone(),
        original_url: url.clone(),
        file_name: clean_filename,
        file_path: final_filepath.to_string_lossy().to_string(),
        directory: target_dir.to_string_lossy().to_string(),
        mime_type,
        file_size,
        downloaded_size: 0,
        status: initial_status,
        download_type: "http".to_string(),
        total_connections: connections,
        active_connections: 0,
        speed: 0.0,
        average_speed: 0.0,
        eta: None,
        error_message: None,
        thumbnail: None,
        progress_sequence: 0,
        file_exists: None,
        created_at: now,
        started_at: None,
        completed_at: None,
        updated_at: now,
    };

    state.db.insert_download(&download)
        .await
        .map_err(|e| e.to_string())?;

    if start_immediately {
        let _ = state.engine.start_download(app, &download.id).await;
    }

    Ok(download)
}

#[tauri::command]
pub async fn start_download(
    app: AppHandle,
    state: State<'_, AppState>,
    download_id: String,
) -> Result<(), String> {
    start_or_resume_download(app, state.inner().clone(), &download_id).await
}

#[tauri::command]
pub async fn pause_download(
    app: AppHandle,
    state: State<'_, AppState>,
    download_id: String,
) -> Result<(), String> {
    state.engine
        .pause_download(app, &download_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn resume_download(
    app: AppHandle,
    state: State<'_, AppState>,
    download_id: String,
) -> Result<(), String> {
    start_or_resume_download(app, state.inner().clone(), &download_id).await
}

pub async fn start_or_resume_download(
    app: AppHandle,
    state: AppState,
    download_id: &str,
) -> Result<(), String> {
    let dl_opt = state.db.get_download(download_id).await.map_err(|e| e.to_string())?;
    let dl = dl_opt.ok_or_else(|| format!("Download not found: {}", download_id))?;

    if dl.download_type.starts_with("media") {
        spawn_media_download(&app, &state, dl).await;
        Ok(())
    } else {
        state
            .engine
            .start_download(app, download_id)
            .await
            .map_err(|e| e.to_string())
    }
}

#[tauri::command]
pub async fn cancel_download(
    app: AppHandle,
    state: State<'_, AppState>,
    download_id: String,
    delete_files: Option<bool>,
) -> Result<(), String> {
    state.engine
        .cancel_download(app, &download_id, delete_files.unwrap_or(false))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_download(
    app: AppHandle,
    state: State<'_, AppState>,
    download_id: String,
    delete_files: Option<bool>,
) -> Result<(), String> {
    let _ = state.engine.pause_download(app, &download_id).await;
    
    if delete_files.unwrap_or(false) {
        if let Ok(Some(dl)) = state.db.get_download(&download_id).await {
            let part_path = PathBuf::from(format!("{}.part", dl.file_path));
            let _ = tokio::fs::remove_file(part_path).await;
            let final_path = PathBuf::from(&dl.file_path);
            let _ = tokio::fs::remove_file(final_path).await;
        }
    }

    state.db.delete_download(&download_id)
        .await
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub async fn list_downloads(state: State<'_, AppState>) -> Result<Vec<Download>, String> {
    let mut downloads = state.db.list_downloads().await.map_err(|e| e.to_string())?;
    for dl in &mut downloads {
        if dl.status == DownloadStatus::Completed {
            let exists = std::path::Path::new(&dl.file_path).exists();
            dl.file_exists = Some(exists);
        }
    }
    Ok(downloads)
}

#[tauri::command]
pub async fn delete_missing_downloads(state: State<'_, AppState>) -> Result<usize, String> {
    let downloads = state.db.list_downloads().await.map_err(|e| e.to_string())?;
    let mut removed_count = 0;
    for dl in downloads {
        if dl.status == DownloadStatus::Completed && !std::path::Path::new(&dl.file_path).exists() {
            let _ = state.db.delete_download(&dl.id).await;
            removed_count += 1;
        }
    }
    Ok(removed_count)
}

#[tauri::command]
pub async fn get_download(
    state: State<'_, AppState>,
    download_id: String,
) -> Result<Option<Download>, String> {
    state.db.get_download(&download_id).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_download_chunks(
    state: State<'_, AppState>,
    download_id: String,
) -> Result<Vec<DownloadChunk>, String> {
    state.db.get_chunks_for_download(&download_id).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn pause_all_downloads(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let downloads = state.db.list_downloads().await.map_err(|e| e.to_string())?;
    for dl in downloads {
        if dl.status == DownloadStatus::Downloading {
            let _ = state.engine.pause_download(app.clone(), &dl.id).await;
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn resume_all_downloads(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let downloads = state.db.list_downloads().await.map_err(|e| e.to_string())?;
    for dl in downloads {
        if dl.status == DownloadStatus::Paused || dl.status == DownloadStatus::Queued {
            let _ = start_or_resume_download(app.clone(), state.inner().clone(), &dl.id).await;
        }
    }
    Ok(())
}

// --- Extractor & Media Commands ---

#[tauri::command]
pub fn check_is_media_url(url: String) -> bool {
    crate::extractor::ExtractorService::is_media_url(&url)
}

#[tauri::command]
pub async fn get_extractor_status(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<crate::extractor::ExtractorStatus, String> {
    Ok(state.extractor.get_status(&app).await)
}

#[tauri::command]
pub async fn extract_media_info(
    app: AppHandle,
    state: State<'_, AppState>,
    url: String,
) -> Result<crate::extractor::MediaInfo, String> {
    state
        .extractor
        .extract_info(&app, &url)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn create_media_download(
    app: AppHandle,
    state: State<'_, AppState>,
    request: crate::extractor::MediaDownloadRequest,
) -> Result<Download, String> {
    let settings = state.settings_mgr.get_settings().await;
    let default_download_dir = dirs::download_dir()
        .unwrap_or_else(|| PathBuf::from("C:\\NovaDownload"))
        .to_string_lossy()
        .to_string();

    let base_dir = request
        .directory
        .filter(|d| !d.trim().is_empty())
        .unwrap_or_else(|| {
            if !settings.default_download_directory.trim().is_empty() {
                settings.default_download_directory.clone()
            } else {
                default_download_dir
            }
        });
    
    let target_dir = if settings.auto_categorize {
        let cat = if request.is_audio_only { "Music" } else { "Videos" };
        if let Some(sub) = settings.category_folders.get(cat) {
            PathBuf::from(&base_dir).join(sub)
        } else {
            PathBuf::from(&base_dir)
        }
    } else {
        PathBuf::from(&base_dir)
    };

    let _ = tokio::fs::create_dir_all(&target_dir).await;
    let canonical_target_dir = std::fs::canonicalize(&target_dir).unwrap_or(target_dir);

    let ext = if request.is_audio_only { "mp3" } else { "mp4" };
    let raw_title = request.file_name.unwrap_or_else(|| "media_download".to_string());
    let clean_title = sanitize_filename(&raw_title);
    let filename = if clean_title.ends_with(&format!(".{}", ext)) {
        clean_title
    } else {
        format!("{}.{}", clean_title, ext)
    };

    let final_filepath = get_unique_filepath(&canonical_target_dir, &filename);
    let dl_id = Uuid::new_v4().to_string();
    let now = Utc::now();
    let download_type = format!("media:{}", if request.is_audio_only { "audio" } else { &request.format_id });

    let download = Download {
        id: dl_id.clone(),
        url: request.url.clone(),
        original_url: request.url.clone(),
        file_name: final_filepath.file_name().unwrap_or_default().to_string_lossy().to_string(),
        file_path: final_filepath.to_string_lossy().to_string(),
        directory: canonical_target_dir.to_string_lossy().to_string(),
        mime_type: Some(if request.is_audio_only { "audio/mp3".to_string() } else { "video/mp4".to_string() }),
        file_size: request.file_size,
        downloaded_size: 0,
        status: DownloadStatus::Downloading,
        download_type,
        total_connections: 1,
        active_connections: 1,
        speed: 0.0,
        average_speed: 0.0,
        eta: None,
        error_message: None,
        thumbnail: request.thumbnail.clone(),
        progress_sequence: 0,
        file_exists: None,
        created_at: now,
        started_at: Some(now),
        completed_at: None,
        updated_at: now,
    };

    state.db.insert_download(&download).await.map_err(|e| e.to_string())?;
    let _ = app.emit("download:created", download.clone());

    spawn_media_download(&app, state.inner(), download.clone()).await;

    Ok(download)
}

pub async fn spawn_media_download(
    app: &AppHandle,
    state: &AppState,
    dl: Download,
) {
    let (format_id, is_audio) = if dl.download_type.starts_with("media:") {
        let sub = dl.download_type.strip_prefix("media:").unwrap_or("best");
        if sub == "audio" {
            ("bestaudio".to_string(), true)
        } else {
            (sub.to_string(), false)
        }
    } else {
        let is_aud = dl.mime_type.as_deref().map_or(false, |m| m.contains("audio"));
        ("best".to_string(), is_aud)
    };

    let cancel_token = CancellationToken::new();
    if !state.engine.register_task(&dl.id, cancel_token.clone()).await {
        info!("Media download {} is already active, ignoring duplicate start", dl.id);
        return;
    }

    let _ = state.db.update_download_status(&dl.id, DownloadStatus::Downloading, None).await;
    let _ = app.emit("download:status_changed", serde_json::json!({
        "download_id": dl.id,
        "status": "downloading"
    }));

    let bin_path = match state.extractor.ensure_binary(app).await {
        Ok(b) => b,
        Err(e) => {
            state.engine.unregister_task(&dl.id).await;
            let err_msg = format!("Failed to ensure extractor binary: {}", e);
            let _ = state.db.update_download_status(&dl.id, DownloadStatus::Failed, Some(&err_msg)).await;
            let _ = app.emit("download:status_changed", serde_json::json!({
                "download_id": dl.id,
                "status": "failed",
                "error": err_msg
            }));
            return;
        }
    };

    let mut cmd = tokio::process::Command::new(&bin_path);
    cmd.arg("--no-playlist");
    cmd.arg("--newline");
    cmd.arg("--no-colors");
    cmd.env("PYTHONIOENCODING", "utf-8");
    cmd.args(&[
        "--progress-template",
        "download:NOVA_PROG:%(info.format_id)s:%(progress.downloaded_bytes)s:%(progress.total_bytes)s:%(progress.total_bytes_estimate)s:%(progress.speed)s:%(progress.eta)s",
    ]);
    cmd.args(&[
        "--progress-template",
        "postprocess:NOVA_POST:%(progress.status)s",
    ]);

    if is_audio {
        cmd.args(&["-f", "bestaudio/best", "-x", "--audio-format", "mp3", "--audio-quality", "0"]);
    } else if format_id == "best" {
        cmd.args(&["-f", "bestvideo+bestaudio/best", "--merge-output-format", "mp4"]);
    } else if format_id.ends_with('p') {
        if let Ok(height) = format_id.trim_end_matches('p').parse::<u32>() {
            let sel = format!("bestvideo[height<={height}]+bestaudio/best[height<={height}]/best");
            cmd.args(&["-f", &sel, "--merge-output-format", "mp4"]);
        } else {
            cmd.args(&["-f", &format!("{}+bestaudio/best", format_id), "--merge-output-format", "mp4"]);
        }
    } else {
        cmd.args(&["-f", &format!("{}+bestaudio/best", format_id), "--merge-output-format", "mp4"]);
    }

    cmd.args(&["-o", &dl.file_path, &dl.url]);
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());

    #[cfg(target_os = "windows")]
    {
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => {
            state.engine.unregister_task(&dl.id).await;
            let err_msg = format!("Failed to spawn extractor: {}", e);
            let _ = state.db.update_download_status(&dl.id, DownloadStatus::Failed, Some(&err_msg)).await;
            let _ = app.emit("download:status_changed", serde_json::json!({
                "download_id": dl.id,
                "status": "failed",
                "error": err_msg
            }));
            return;
        }
    };

    let dl_id = dl.id.clone();
    let out_template = dl.file_path.clone();
    let app_handle = app.clone();
    let db = state.db.clone();
    let engine = state.engine.clone();

    tauri::async_runtime::spawn(async move {
        let start_time = std::time::Instant::now();
        let mut stream_downloaded: HashMap<String, i64> = HashMap::new();
        let mut stream_total: HashMap<String, i64> = HashMap::new();
        let mut monotonic_downloaded: i64 = dl.downloaded_size;
        let mut locked_total_size: i64 = dl.file_size.unwrap_or(0);
        let mut max_overall_pct: f64 = 0.0;
        let mut latest_speed: f64 = 0.0;
        let mut latest_eta: Option<i64> = None;
        let mut progress_sequence: u64 = dl.progress_sequence;
        let mut last_emit = std::time::Instant::now();
        let mut last_db_update = std::time::Instant::now();
        let mut is_postprocessing = false;

        if locked_total_size > 0 {
            let _ = app_handle.emit("download:progress", serde_json::json!({
                "download_id": dl_id,
                "downloaded_size": monotonic_downloaded,
                "file_size": Some(locked_total_size),
                "percentage": 0.0,
                "speed": 0.0,
                "average_speed": 0.0,
                "eta": null,
                "active_connections": 1,
                "status": "downloading",
                "progress_sequence": progress_sequence
            }));
        }

        if let Some(stdout) = child.stdout.take() {
            let mut reader = BufReader::new(stdout);
            let mut line_buf = Vec::new();
            loop {
                line_buf.clear();
                let read_res = tokio::select! {
                    _ = cancel_token.cancelled() => {
                        info!("Media download {} cancelled / paused. Terminating yt-dlp.", dl_id);
                        let _ = child.kill().await;
                        let _ = child.wait().await;
                        engine.unregister_task(&dl_id).await;
                        return;
                    }
                    res = reader.read_until(b'\n', &mut line_buf) => res,
                };

                match read_res {
                    Ok(0) => break, // EOF reached
                    Ok(_) => {}
                    Err(e) => {
                        warn!("Error reading stdout bytes from yt-dlp: {}", e);
                        break;
                    }
                };

                let line = String::from_utf8_lossy(&line_buf).trim().to_string();
                if line.is_empty() {
                    continue;
                }

                if line.contains("NOVA_POST") || line.contains("[Merger]") || line.contains("Merging") || line.contains("[Fixup") || line.contains("[ExtractAudio") {
                    is_postprocessing = true;
                    max_overall_pct = 99.0;
                    progress_sequence += 1;
                    let _ = app_handle.emit("download:progress", serde_json::json!({
                        "download_id": dl_id,
                        "downloaded_size": monotonic_downloaded,
                        "file_size": if locked_total_size > 0 { Some(locked_total_size) } else { None },
                        "percentage": 99.0,
                        "speed": 0.0,
                        "average_speed": latest_speed,
                        "eta": null,
                        "active_connections": 1,
                        "status": "processing",
                        "progress_sequence": progress_sequence
                    }));
                    continue;
                }

                if line.contains("NOVA_PROG:") {
                    if let Some(info) = parse_nova_prog_line(&line) {
                        let fmt = info.format_id;
                        stream_downloaded.insert(fmt.clone(), info.downloaded_bytes);
                        if let Some(tot) = info.total_bytes {
                            if tot > 0 {
                                stream_total.insert(fmt.clone(), tot);
                            }
                        }

                        if info.speed > 0.0 {
                            latest_speed = info.speed;
                        }
                        if info.eta > 0 {
                            latest_eta = Some(info.eta);
                        }

                        let sum_downloaded: i64 = stream_downloaded.values().sum();
                        monotonic_downloaded = monotonic_downloaded.max(sum_downloaded);

                        let sum_total: i64 = stream_total.values().sum();
                        if sum_total > locked_total_size {
                            locked_total_size = sum_total;
                        }

                        let pct = if locked_total_size > 0 {
                            ((monotonic_downloaded as f64 / locked_total_size as f64) * 100.0).min(99.0)
                        } else {
                            0.0
                        };
                        max_overall_pct = max_overall_pct.max(pct).min(99.0);

                        let now = std::time::Instant::now();
                        if now.duration_since(last_emit).as_millis() >= 100 {
                            last_emit = now;
                            progress_sequence += 1;

                            let _ = app_handle.emit("download:progress", serde_json::json!({
                                "download_id": dl_id,
                                "downloaded_size": monotonic_downloaded,
                                "file_size": if locked_total_size > 0 { Some(locked_total_size) } else { None },
                                "percentage": max_overall_pct,
                                "speed": latest_speed,
                                "average_speed": latest_speed,
                                "eta": latest_eta,
                                "active_connections": 1,
                                "status": if is_postprocessing { "processing" } else { "downloading" },
                                "progress_sequence": progress_sequence
                            }));

                            if now.duration_since(last_db_update).as_millis() >= 1500 {
                                last_db_update = now;
                                let _ = db.update_download_progress(
                                    &dl_id,
                                    monotonic_downloaded,
                                    latest_speed,
                                    latest_speed,
                                    latest_eta,
                                    1,
                                    progress_sequence,
                                ).await;
                                if locked_total_size > 0 {
                                    let _ = db.update_download_file_size(&dl_id, locked_total_size).await;
                                }
                            }
                        }
                    }
                } else if let Some((raw_pct, total_bytes, speed, eta)) = parse_ytdlp_line(&line) {
                    if total_bytes > 0 && total_bytes > locked_total_size {
                        locked_total_size = total_bytes;
                    }
                    if speed > 0.0 {
                        latest_speed = speed;
                    }
                    if eta > 0 {
                        latest_eta = Some(eta);
                    }
                    let est_downloaded = if locked_total_size > 0 {
                        ((raw_pct / 100.0) * locked_total_size as f64) as i64
                    } else {
                        0
                    };
                    monotonic_downloaded = monotonic_downloaded.max(est_downloaded);
                    max_overall_pct = max_overall_pct.max(raw_pct).min(99.0);

                    let now = std::time::Instant::now();
                    if now.duration_since(last_emit).as_millis() >= 100 {
                        last_emit = now;
                        progress_sequence += 1;

                        let _ = app_handle.emit("download:progress", serde_json::json!({
                            "download_id": dl_id,
                            "downloaded_size": monotonic_downloaded,
                            "file_size": if locked_total_size > 0 { Some(locked_total_size) } else { None },
                            "percentage": max_overall_pct,
                            "speed": latest_speed,
                            "average_speed": latest_speed,
                            "eta": latest_eta,
                            "active_connections": 1,
                            "status": "downloading",
                            "progress_sequence": progress_sequence
                        }));
                    }
                }
            }
        }

        let wait_res = tokio::select! {
            _ = cancel_token.cancelled() => {
                info!("Media download {} cancelled / paused while finishing. Terminating.", dl_id);
                let _ = child.kill().await;
                let _ = child.wait().await;
                engine.unregister_task(&dl_id).await;
                return;
            }
            res = child.wait() => {
                res
            }
        };

        engine.unregister_task(&dl_id).await;

        if let Ok(exit_status) = wait_res {
            if exit_status.success() {
                let mut actual_path = PathBuf::from(&out_template);
                if !actual_path.exists() {
                    let candidate_mp3 = PathBuf::from(format!("{}.mp3", out_template));
                    let candidate_mp4 = PathBuf::from(format!("{}.mp4", out_template));
                    let candidate_mkv = PathBuf::from(format!("{}.mkv", out_template));
                    let candidate_webm = PathBuf::from(format!("{}.webm", out_template));
                    if candidate_mp3.exists() {
                        actual_path = candidate_mp3;
                    } else if candidate_mp4.exists() {
                        actual_path = candidate_mp4;
                    } else if candidate_mkv.exists() {
                        actual_path = candidate_mkv;
                    } else if candidate_webm.exists() {
                        actual_path = candidate_webm;
                    }
                }

                let file_size = tokio::fs::metadata(&actual_path)
                    .await
                    .map(|m| m.len() as i64)
                    .ok()
                    .unwrap_or(monotonic_downloaded);

                let actual_filename = actual_path
                    .file_name()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .to_string();
                let actual_filepath_str = actual_path.to_string_lossy().to_string();

                let elapsed_secs = start_time.elapsed().as_secs_f64().max(1.0);
                let avg_speed = (file_size as f64 / elapsed_secs).max(latest_speed);
                progress_sequence += 1;

                let _ = db.update_download_file_path(&dl_id, &actual_filename, &actual_filepath_str).await;
                let _ = db.update_download_file_size(&dl_id, file_size).await;
                let _ = db.update_download_progress(&dl_id, file_size, 0.0, avg_speed, None, 0, progress_sequence).await;
                let _ = db.update_download_status(&dl_id, DownloadStatus::Completed, None).await;

                let _ = app_handle.emit("download:progress", serde_json::json!({
                    "download_id": dl_id,
                    "downloaded_size": file_size,
                    "file_size": file_size,
                    "percentage": 100.0,
                    "speed": 0.0,
                    "average_speed": avg_speed,
                    "eta": null,
                    "active_connections": 0,
                    "status": "completed",
                    "progress_sequence": progress_sequence
                }));

                let _ = app_handle.emit("download:status_changed", serde_json::json!({
                    "download_id": dl_id,
                    "status": "completed"
                }));
            } else {
                if cancel_token.is_cancelled() {
                    return;
                }
                let _ = db.update_download_status(&dl_id, DownloadStatus::Failed, Some("Extraction process failed")).await;
                let _ = app_handle.emit("download:status_changed", serde_json::json!({
                    "download_id": dl_id,
                    "status": "failed",
                    "error": "Extraction failed"
                }));
            }
        }
    });
}

#[derive(Debug, Clone, PartialEq)]
pub struct NovaProgInfo {
    pub format_id: String,
    pub downloaded_bytes: i64,
    pub total_bytes: Option<i64>,
    pub speed: f64,
    pub eta: i64,
}

pub fn parse_nova_prog_line(line: &str) -> Option<NovaProgInfo> {
    let idx = line.find("NOVA_PROG:")?;
    let content = &line[idx + "NOVA_PROG:".len()..];
    let parts: Vec<&str> = content.split(':').collect();
    if parts.len() < 6 {
        return None;
    }

    let format_id = parts[0].trim().to_string();
    let downloaded_bytes = parts[1].trim().parse::<i64>().unwrap_or(0);
    let total_bytes_raw = parts[2].trim();
    let total_est_raw = parts[3].trim();
    let speed_raw = parts[4].trim();
    let eta_raw = parts[5].trim();

    let total_bytes = if total_bytes_raw != "NA" && !total_bytes_raw.is_empty() {
        total_bytes_raw
            .parse::<i64>()
            .ok()
            .or_else(|| total_bytes_raw.parse::<f64>().map(|v| v as i64).ok())
    } else if total_est_raw != "NA" && !total_est_raw.is_empty() {
        total_est_raw
            .parse::<i64>()
            .ok()
            .or_else(|| total_est_raw.parse::<f64>().map(|v| v as i64).ok())
    } else {
        None
    };

    let speed = if speed_raw != "NA" && !speed_raw.is_empty() {
        speed_raw.parse::<f64>().unwrap_or(0.0)
    } else {
        0.0
    };

    let eta = if eta_raw != "NA" && !eta_raw.is_empty() {
        eta_raw.parse::<f64>().unwrap_or(0.0) as i64
    } else {
        0
    };

    Some(NovaProgInfo {
        format_id,
        downloaded_bytes,
        total_bytes,
        speed,
        eta,
    })
}

fn parse_ytdlp_line(line: &str) -> Option<(f64, i64, f64, i64)> {
    if !line.contains("[download]") || !line.contains('%') {
        return None;
    }

    let parts: Vec<&str> = line.split_whitespace().collect();
    let mut percentage: f64 = 0.0;
    let mut total_bytes: i64 = 0;
    let mut speed_bytes_per_sec: f64 = 0.0;
    let mut eta_secs: i64 = 0;

    for (i, &p) in parts.iter().enumerate() {
        if p.ends_with('%') {
            if let Ok(pct) = p.trim_end_matches('%').parse::<f64>() {
                percentage = pct;
            }
        } else if p == "of" && i + 1 < parts.len() {
            let mut idx = i + 1;
            while idx < parts.len() && (parts[idx] == "~" || parts[idx].is_empty()) {
                idx += 1;
            }
            if idx < parts.len() {
                let size_str = parts[idx].trim_start_matches('~');
                total_bytes = parse_size_str(size_str);
            }
        } else if p == "at" && i + 1 < parts.len() {
            let mut idx = i + 1;
            while idx < parts.len() && (parts[idx] == "~" || parts[idx].is_empty()) {
                idx += 1;
            }
            if idx < parts.len() {
                speed_bytes_per_sec = parse_speed_str(parts[idx]);
            }
        } else if p == "ETA" && i + 1 < parts.len() {
            eta_secs = parse_eta_str(parts[i + 1]);
        }
    }

    if percentage >= 0.0 {
        Some((percentage, total_bytes, speed_bytes_per_sec, eta_secs))
    } else {
        None
    }
}

fn parse_size_str(s: &str) -> i64 {
    let s = s.trim();
    if s.ends_with("GiB") || s.ends_with("GB") {
        let num = s.trim_end_matches("GiB").trim_end_matches("GB").parse::<f64>().unwrap_or(0.0);
        (num * 1024.0 * 1024.0 * 1024.0) as i64
    } else if s.ends_with("MiB") || s.ends_with("MB") {
        let num = s.trim_end_matches("MiB").trim_end_matches("MB").parse::<f64>().unwrap_or(0.0);
        (num * 1024.0 * 1024.0) as i64
    } else if s.ends_with("KiB") || s.ends_with("KB") {
        let num = s.trim_end_matches("KiB").trim_end_matches("KB").parse::<f64>().unwrap_or(0.0);
        (num * 1024.0) as i64
    } else if s.ends_with('B') {
        s.trim_end_matches('B').parse::<i64>().unwrap_or(0)
    } else {
        0
    }
}

fn parse_speed_str(s: &str) -> f64 {
    let s = s.trim();
    if s.ends_with("GiB/s") || s.ends_with("GB/s") {
        let num = s.trim_end_matches("GiB/s").trim_end_matches("GB/s").parse::<f64>().unwrap_or(0.0);
        num * 1024.0 * 1024.0 * 1024.0
    } else if s.ends_with("MiB/s") || s.ends_with("MB/s") {
        let num = s.trim_end_matches("MiB/s").trim_end_matches("MB/s").parse::<f64>().unwrap_or(0.0);
        num * 1024.0 * 1024.0
    } else if s.ends_with("KiB/s") || s.ends_with("KB/s") {
        let num = s.trim_end_matches("KiB/s").trim_end_matches("KB/s").parse::<f64>().unwrap_or(0.0);
        num * 1024.0
    } else if s.ends_with("B/s") {
        s.trim_end_matches("B/s").parse::<f64>().unwrap_or(0.0)
    } else {
        0.0
    }
}

fn parse_eta_str(s: &str) -> i64 {
    let parts: Vec<&str> = s.split(':').collect();
    if parts.len() == 2 {
        let m = parts[0].parse::<i64>().unwrap_or(0);
        let sec = parts[1].parse::<i64>().unwrap_or(0);
        m * 60 + sec
    } else if parts.len() == 3 {
        let h = parts[0].parse::<i64>().unwrap_or(0);
        let m = parts[1].parse::<i64>().unwrap_or(0);
        let sec = parts[2].parse::<i64>().unwrap_or(0);
        h * 3600 + m * 60 + sec
    } else {
        0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_nova_prog_line_valid() {
        let line = "NOVA_PROG:mp4:104856576:104857600:NA:195612969.5:12";
        let info = parse_nova_prog_line(line).expect("Should parse");
        assert_eq!(info.format_id, "mp4");
        assert_eq!(info.downloaded_bytes, 104856576);
        assert_eq!(info.total_bytes, Some(104857600));
        assert!((info.speed - 195612969.5).abs() < 1e-4);
        assert_eq!(info.eta, 12);
    }

    #[test]
    fn test_parse_nova_prog_line_with_estimate() {
        let line = "NOVA_PROG:137:5000000:NA:52428800:1000000.0:47";
        let info = parse_nova_prog_line(line).expect("Should parse");
        assert_eq!(info.format_id, "137");
        assert_eq!(info.downloaded_bytes, 5000000);
        assert_eq!(info.total_bytes, Some(52428800));
        assert_eq!(info.eta, 47);
    }

    #[test]
    fn test_parse_nova_prog_line_na_values() {
        let line = "NOVA_PROG:mp4:1024:NA:NA:NA:NA";
        let info = parse_nova_prog_line(line).expect("Should parse");
        assert_eq!(info.format_id, "mp4");
        assert_eq!(info.downloaded_bytes, 1024);
        assert_eq!(info.total_bytes, None);
        assert_eq!(info.speed, 0.0);
        assert_eq!(info.eta, 0);
    }
}


