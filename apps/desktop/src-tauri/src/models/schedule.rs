use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Schedule {
    pub id: String,
    pub download_id: Option<String>,
    pub queue_id: Option<String>,
    pub start_at: Option<DateTime<Utc>>,
    pub end_at: Option<DateTime<Utc>>,
    pub days_of_week: String, // "Mon,Tue,Wed,Thu,Fri,Sat,Sun"
    pub enabled: bool,
}
