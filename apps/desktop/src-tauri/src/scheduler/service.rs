use crate::database::Database;
use crate::downloader::DownloadEngine;
use chrono::{Datelike, Timelike, Utc};
use std::time::Duration;
use tauri::AppHandle;
use tokio::time::sleep;

#[derive(Clone)]
pub struct SchedulerService {
    #[allow(dead_code)]
    db: Database,
    #[allow(dead_code)]
    engine: DownloadEngine,
}

impl SchedulerService {
    pub fn new(db: Database, engine: DownloadEngine) -> Self {
        Self { db, engine }
    }

    pub fn start_scheduler_worker(&self, app: AppHandle) {
        let sched = self.clone();
        tauri::async_runtime::spawn(async move {
            loop {
                sched.check_schedules(&app).await;
                sleep(Duration::from_secs(30)).await;
            }
        });
    }

    async fn check_schedules(&self, _app: &AppHandle) {
        let now = Utc::now();
        let _current_weekday = match now.weekday() {
            chrono::Weekday::Mon => "Mon",
            chrono::Weekday::Tue => "Tue",
            chrono::Weekday::Wed => "Wed",
            chrono::Weekday::Thu => "Thu",
            chrono::Weekday::Fri => "Fri",
            chrono::Weekday::Sat => "Sat",
            chrono::Weekday::Sun => "Sun",
        };

        let _current_time_mins = now.hour() * 60 + now.minute();
    }
}
