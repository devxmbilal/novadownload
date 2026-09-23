use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloadHistory {
    pub id: String,
    pub download_id: String,
    pub action: String,
    pub metadata: Option<String>,
    pub created_at: DateTime<Utc>,
}
