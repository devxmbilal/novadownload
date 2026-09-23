use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppSettings {
    pub default_download_directory: String,
    pub default_connections: u32,
    pub max_concurrent_downloads: u32,
    pub global_speed_limit: u64, // bytes/sec, 0 = unlimited
    pub auto_categorize: bool,
    pub category_folders: HashMap<String, String>,
    pub duplicate_action: String, // "ask", "overwrite", "rename", "skip"
    pub clipboard_monitor_enabled: bool,
    pub notifications_enabled: bool,
    pub minimize_to_tray: bool,
    pub close_to_tray: bool,
    pub theme: String, // "dark", "light", "system"
    pub user_agent: String,
    pub proxy_url: Option<String>,
    pub retry_count: u32,
    pub retry_delay_seconds: u32,
    pub browser_bridge_port: u16,
    pub browser_bridge_token: String,
    pub ffmpeg_path: Option<String>,
}

impl Default for AppSettings {
    fn default() -> Self {
        let default_dir = dirs::download_dir()
            .unwrap_or_else(|| std::path::PathBuf::from("."))
            .to_string_lossy()
            .to_string();

        let mut category_folders = HashMap::new();
        category_folders.insert("Videos".to_string(), "Videos".to_string());
        category_folders.insert("Music".to_string(), "Music".to_string());
        category_folders.insert("Documents".to_string(), "Documents".to_string());
        category_folders.insert("Images".to_string(), "Images".to_string());
        category_folders.insert("Archives".to_string(), "Archives".to_string());
        category_folders.insert("Programs".to_string(), "Programs".to_string());
        category_folders.insert("Other".to_string(), "Other".to_string());

        Self {
            default_download_directory: default_dir,
            default_connections: 4,
            max_concurrent_downloads: 3,
            global_speed_limit: 0,
            auto_categorize: true,
            category_folders,
            duplicate_action: "rename".to_string(),
            clipboard_monitor_enabled: true,
            notifications_enabled: true,
            minimize_to_tray: true,
            close_to_tray: true,
            theme: "dark".to_string(),
            user_agent: "NovaDownload/1.0.0 (Windows NT 10.0; Win64; x64)".to_string(),
            proxy_url: None,
            retry_count: 3,
            retry_delay_seconds: 5,
            browser_bridge_port: 64123,
            browser_bridge_token: uuid::Uuid::new_v4().to_string(),
            ffmpeg_path: None,
        }
    }
}
