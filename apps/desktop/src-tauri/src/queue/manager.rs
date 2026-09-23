use crate::database::Database;
use crate::downloader::DownloadEngine;
use crate::models::DownloadStatus;
use std::time::Duration;
use tauri::AppHandle;
use tokio::time::sleep;
use tracing::info;

#[derive(Clone)]
pub struct QueueManager {
    db: Database,
    engine: DownloadEngine,
}

impl QueueManager {
    pub fn new(db: Database, engine: DownloadEngine) -> Self {
        Self { db, engine }
    }

    pub fn start_queue_worker(&self, app: AppHandle) {
        let qm = self.clone();
        tauri::async_runtime::spawn(async move {
            loop {
                qm.process_queues(app.clone()).await;
                sleep(Duration::from_secs(2)).await;
            }
        });
    }

    async fn process_queues(&self, app: AppHandle) {
        let downloads = match self.db.list_downloads().await {
            Ok(d) => d,
            Err(_) => return,
        };

        let active_count = downloads
            .iter()
            .filter(|d| d.status == DownloadStatus::Downloading)
            .count();

        // Get max concurrent limit from settings or default to 3
        let max_concurrent: usize = 3;

        if active_count < max_concurrent {
            let slots_available = max_concurrent - active_count;
            let mut started = 0;

            for dl in downloads.iter() {
                if started >= slots_available {
                    break;
                }

                if dl.status == DownloadStatus::Queued || dl.status == DownloadStatus::Pending {
                    info!("Auto-starting queued download {}", dl.id);
                    if self.engine.start_download(app.clone(), &dl.id).await.is_ok() {
                        started += 1;
                    }
                }
            }
        }
    }
}
