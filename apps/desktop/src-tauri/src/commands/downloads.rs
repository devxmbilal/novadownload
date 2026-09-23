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
