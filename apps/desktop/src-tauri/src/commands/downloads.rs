use crate::downloader::probe_url as engine_probe_url;
use crate::filesystem::{get_unique_filepath, sanitize_filename};
use crate::models::*;
use crate::state::AppState;
use chrono::Utc;
use std::path::PathBuf;
use tauri::{AppHandle, State};
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
    state.engine
        .start_download(app, &download_id)
        .await
        .map_err(|e| e.to_string())
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
    state.engine
        .start_download(app, &download_id)
        .await
        .map_err(|e| e.to_string())
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
    state.db.list_downloads().await.map_err(|e| e.to_string())
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
            let _ = state.engine.start_download(app.clone(), &dl.id).await;
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
    use std::process::Stdio;
    use tauri::Emitter;
    use tokio::io::{AsyncBufReadExt, BufReader};

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

    let download = Download {
        id: dl_id.clone(),
        url: request.url.clone(),
        original_url: request.url.clone(),
        file_name: final_filepath.file_name().unwrap_or_default().to_string_lossy().to_string(),
        file_path: final_filepath.to_string_lossy().to_string(),
        directory: canonical_target_dir.to_string_lossy().to_string(),
        mime_type: Some(if request.is_audio_only { "audio/mp3".to_string() } else { "video/mp4".to_string() }),
        file_size: None,
        downloaded_size: 0,
        status: DownloadStatus::Downloading,
        download_type: "media".to_string(),
        total_connections: 1,
        active_connections: 1,
        speed: 0.0,
        average_speed: 0.0,
        eta: None,
        error_message: None,
        thumbnail: request.thumbnail.clone(),
        created_at: now,
        started_at: Some(now),
        completed_at: None,
        updated_at: now,
    };

    state.db.insert_download(&download).await.map_err(|e| e.to_string())?;
    let _ = app.emit("download:created", download.clone());

    // Spawn async background worker using yt-dlp
    let bin_path = state.extractor.ensure_binary(&app).await.map_err(|e| e.to_string())?;
    let app_handle = app.clone();
    let db = state.db.clone();
    let url = request.url.clone();
    let format_id = request.format_id.clone();
    let is_audio = request.is_audio_only;
    let out_template = final_filepath.to_string_lossy().to_string();

    tauri::async_runtime::spawn(async move {
        let mut cmd = tokio::process::Command::new(&bin_path);
        cmd.arg("--no-playlist");
        cmd.arg("--newline");
        cmd.arg("--no-colors");

        if is_audio {
            cmd.args(&["-f", "bestaudio/best", "-x", "--audio-format", "mp3", "--audio-quality", "0"]);
        } else if format_id == "best" {
            cmd.args(&["-f", "bestvideo+bestaudio/best", "--merge-output-format", "mp4"]);
        } else {
            cmd.args(&["-f", &format!("{}+bestaudio/best", format_id), "--merge-output-format", "mp4"]);
        }

        cmd.args(&["-o", &out_template, &url]);
        cmd.stdout(Stdio::piped());
        cmd.stderr(Stdio::piped());

        let start_time = std::time::Instant::now();
        let mut stream_count: usize = 0;
        let mut stream_sizes: Vec<i64> = Vec::new();
        let mut last_stream_size: i64 = 0;
        let mut max_overall_pct: f64 = 0.0;
        let mut max_downloaded_bytes: i64 = 0;
        let mut latest_speed: f64 = 0.0;

        if let Ok(mut child) = cmd.spawn() {
            if let Some(stdout) = child.stdout.take() {
                let mut reader = BufReader::new(stdout).lines();
                while let Ok(Some(line)) = reader.next_line().await {
                    if line.contains("Destination:") {
                        if last_stream_size > 0 {
                            stream_sizes.push(last_stream_size);
                        }
                        stream_count += 1;
                        last_stream_size = 0;
                    }

                    if line.contains("[Merger]") || line.contains("Merging") {
                        max_overall_pct = 99.0;
                        let _ = app_handle.emit("download:progress", serde_json::json!({
                            "download_id": dl_id,
                            "downloaded_size": max_downloaded_bytes,
                            "file_size": if stream_sizes.is_empty() { None } else { Some(stream_sizes.iter().sum::<i64>()) },
                            "percentage": 99.0,
                            "speed": 0.0,
                            "average_speed": latest_speed,
                            "eta": 1,
                            "active_connections": 1,
                            "status": "processing"
                        }));
                        continue;
                    }

                    if let Some((raw_pct, total_bytes, speed, eta)) = parse_ytdlp_line(&line) {
                        if total_bytes > 0 {
                            last_stream_size = total_bytes;
                        }
                        if speed > 0.0 {
                            latest_speed = speed;
                        }

                        let overall_pct = if is_audio || format_id.contains("audio") {
                            raw_pct
                        } else if stream_count <= 1 {
                            raw_pct * 0.85
                        } else {
                            85.0 + (raw_pct * 0.13)
                        };

                        max_overall_pct = max_overall_pct.max(overall_pct).min(99.0);

                        let estimated_total = if is_audio {
                            if total_bytes > 0 { total_bytes } else { last_stream_size }
                        } else if stream_count <= 1 {
                            let curr = if total_bytes > 0 { total_bytes } else { last_stream_size };
                            if curr > 0 { (curr as f64 / 0.85) as i64 } else { 0 }
                        } else {
                            let video_size = stream_sizes.get(0).copied().unwrap_or(last_stream_size * 5);
                            let audio_size = if total_bytes > 0 { total_bytes } else { last_stream_size };
                            video_size + audio_size
                        };

                        let computed_downloaded = if estimated_total > 0 {
                            ((max_overall_pct / 100.0) * (estimated_total as f64)) as i64
                        } else {
                            0
                        };

                        max_downloaded_bytes = max_downloaded_bytes.max(computed_downloaded);

                        let _ = app_handle.emit("download:progress", serde_json::json!({
                            "download_id": dl_id,
                            "downloaded_size": max_downloaded_bytes,
                            "file_size": if estimated_total > 0 { Some(estimated_total) } else { None },
                            "percentage": max_overall_pct,
                            "speed": speed,
                            "average_speed": speed,
                            "eta": if eta > 0 { Some(eta) } else { None },
                            "active_connections": 1,
                            "status": "downloading"
                        }));
                    }
                }
            }

            let status = child.wait().await;
            if let Ok(exit_status) = status {
                if exit_status.success() {
                    // Locate actual file created on disk
                    let mut actual_path = PathBuf::from(&out_template);
                    if !actual_path.exists() {
                        let candidate_mp3 = PathBuf::from(format!("{}.mp3", out_template));
                        let candidate_mp4 = PathBuf::from(format!("{}.mp4", out_template));
                        if candidate_mp3.exists() {
                            actual_path = candidate_mp3;
                        } else if candidate_mp4.exists() {
                            actual_path = candidate_mp4;
                        }
                    }

                    let file_size = tokio::fs::metadata(&actual_path)
                        .await
                        .map(|m| m.len() as i64)
                        .ok()
                        .unwrap_or(max_downloaded_bytes);

                    let actual_filename = actual_path
                        .file_name()
                        .unwrap_or_default()
                        .to_string_lossy()
                        .to_string();
                    let actual_filepath_str = actual_path.to_string_lossy().to_string();

                    let elapsed_secs = start_time.elapsed().as_secs_f64().max(1.0);
                    let avg_speed = (file_size as f64 / elapsed_secs).max(latest_speed);

                    let _ = db.update_download_file_path(&dl_id, &actual_filename, &actual_filepath_str).await;
                    let _ = db.update_download_file_size(&dl_id, file_size).await;
                    let _ = db.update_download_progress(&dl_id, file_size, 0.0, avg_speed, None, 0).await;
                    let _ = db.update_download_status(&dl_id, DownloadStatus::Completed, None).await;

                    let _ = app_handle.emit("download:progress", serde_json::json!({
                        "download_id": dl_id,
                        "downloaded_size": file_size,
                        "file_size": file_size,
                        "percentage": 100.0,
                        "speed": 0.0,
                        "average_speed": avg_speed,
                        "eta": 0,
                        "active_connections": 0,
                        "status": "completed"
                    }));

                    let _ = app_handle.emit("download:status_changed", serde_json::json!({
                        "download_id": dl_id,
                        "status": "completed"
                    }));
                } else {
                    let _ = db.update_download_status(&dl_id, DownloadStatus::Failed, Some("Extraction process failed")).await;
                    let _ = app_handle.emit("download:status_changed", serde_json::json!({
                        "download_id": dl_id,
                        "status": "failed",
                        "error": "Extraction failed"
                    }));
                }
            }
        }
    });

    Ok(download)
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


