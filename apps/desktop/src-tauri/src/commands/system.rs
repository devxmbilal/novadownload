use crate::models::{DownloadStatus, SystemStats};
use crate::state::AppState;
use tauri::State;

#[tauri::command]
pub async fn open_file_or_dir(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let win_path = path.replace('/', "\\");
        let p = std::path::Path::new(&win_path);
        let target = if p.exists() {
            &win_path
        } else if let Some(parent) = p.parent() {
            &parent.to_string_lossy().replace('/', "\\")
        } else {
            &win_path
        };
        std::process::Command::new("explorer")
            .arg(target)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn show_in_folder(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let win_path = path.replace('/', "\\");
        let p = std::path::Path::new(&win_path);
        if p.exists() {
            std::process::Command::new("explorer")
                .arg(format!("/select,{}", win_path))
                .spawn()
                .map_err(|e| e.to_string())?;
        } else if let Some(parent) = p.parent() {
            let parent_win = parent.to_string_lossy().replace('/', "\\");
            std::process::Command::new("explorer")
                .arg(&parent_win)
                .spawn()
                .map_err(|e| e.to_string())?;
        } else {
            std::process::Command::new("explorer")
                .arg(&win_path)
                .spawn()
                .map_err(|e| e.to_string())?;
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        if let Some(parent) = std::path::Path::new(&path).parent() {
            let parent_str = parent.to_string_lossy().to_string();
            open_file_or_dir(parent_str).await?;
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn get_system_stats(state: State<'_, AppState>) -> Result<SystemStats, String> {
    let downloads = state.db.list_downloads().await.map_err(|e| e.to_string())?;

    let total = downloads.len();
    let mut active = 0;
    let mut completed = 0;
    let mut failed = 0;
    let mut current_speed = 0.0;
    let mut total_bytes = 0i64;

    for d in &downloads {
        total_bytes += d.downloaded_size;
        match d.status {
            DownloadStatus::Downloading => {
                active += 1;
                current_speed += d.speed;
            }
            DownloadStatus::Completed => {
                completed += 1;
            }
            DownloadStatus::Failed => {
                failed += 1;
            }
            _ => {}
        }
    }

    Ok(SystemStats {
        total_downloads: total,
        active_downloads: active,
        completed_downloads: completed,
        failed_downloads: failed,
        current_download_speed: current_speed,
        total_bytes_downloaded: total_bytes,
    })
}

#[tauri::command]
pub async fn recover_downloads(state: State<'_, AppState>) -> Result<Vec<String>, String> {
    state.db.recover_interrupted_downloads().await.map_err(|e| e.to_string())
}
