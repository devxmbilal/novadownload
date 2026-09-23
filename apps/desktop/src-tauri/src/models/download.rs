use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DownloadStatus {
    Pending,
    Queued,
    Downloading,
    Paused,
    Completed,
    Failed,
    Cancelled,
    Merging,
    Processing,
}

impl ToString for DownloadStatus {
    fn to_string(&self) -> String {
        match self {
            DownloadStatus::Pending => "pending".to_string(),
            DownloadStatus::Queued => "queued".to_string(),
            DownloadStatus::Downloading => "downloading".to_string(),
            DownloadStatus::Paused => "paused".to_string(),
            DownloadStatus::Completed => "completed".to_string(),
            DownloadStatus::Failed => "failed".to_string(),
            DownloadStatus::Cancelled => "cancelled".to_string(),
            DownloadStatus::Merging => "merging".to_string(),
            DownloadStatus::Processing => "processing".to_string(),
        }
    }
}

impl From<&str> for DownloadStatus {
    fn from(s: &str) -> Self {
        match s {
            "pending" => DownloadStatus::Pending,
            "queued" => DownloadStatus::Queued,
            "downloading" => DownloadStatus::Downloading,
            "paused" => DownloadStatus::Paused,
            "completed" => DownloadStatus::Completed,
            "failed" => DownloadStatus::Failed,
            "cancelled" => DownloadStatus::Cancelled,
            "merging" => DownloadStatus::Merging,
            "processing" => DownloadStatus::Processing,
            _ => DownloadStatus::Pending,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Download {
    pub id: String,
    pub url: String,
    pub original_url: String,
    pub file_name: String,
    pub file_path: String,
    pub directory: String,
    pub mime_type: Option<String>,
    pub file_size: Option<i64>,
    pub downloaded_size: i64,
    pub status: DownloadStatus,
    pub download_type: String,
    pub total_connections: u32,
    pub active_connections: u32,
    pub speed: f64,
    pub average_speed: f64,
    pub eta: Option<i64>,
    pub error_message: Option<String>,
    pub thumbnail: Option<String>,
    pub progress_sequence: u64,
    pub created_at: DateTime<Utc>,
    pub started_at: Option<DateTime<Utc>>,
    pub completed_at: Option<DateTime<Utc>>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloadChunk {
    pub id: String,
    pub download_id: String,
    pub chunk_index: u32,
    pub start_byte: i64,
    pub end_byte: i64,
    pub downloaded_bytes: i64,
    pub status: String,
    pub etag: Option<String>,
    pub last_modified: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloadProgressPayload {
    pub download_id: String,
    pub downloaded_size: i64,
    pub file_size: Option<i64>,
    pub percentage: f64,
    pub speed: f64,
    pub average_speed: f64,
    pub eta: Option<i64>,
    pub active_connections: u32,
    pub status: DownloadStatus,
    pub progress_sequence: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AddDownloadRequest {
    pub url: String,
    pub directory: Option<String>,
    pub file_name: Option<String>,
    pub category: Option<String>,
    pub connections: Option<u32>,
    pub start_immediately: Option<bool>,
    pub queue_id: Option<String>,
    pub speed_limit: Option<u64>,
    pub headers: Option<std::collections::HashMap<String, String>>,
    pub is_media: Option<bool>,
    pub audio_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UrlProbeResult {
    pub url: String,
    pub file_name: String,
    pub file_size: Option<i64>,
    pub mime_type: Option<String>,
    pub accept_ranges: bool,
    pub suggested_category: String,
    pub etag: Option<String>,
    pub last_modified: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SystemStats {
    pub total_downloads: usize,
    pub active_downloads: usize,
    pub completed_downloads: usize,
    pub failed_downloads: usize,
    pub current_download_speed: f64,
    pub total_bytes_downloaded: i64,
}

