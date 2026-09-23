use crate::database::Database;
use crate::downloader::DownloadEngine;
use crate::extractor::ExtractorService;
use crate::ffmpeg::FFmpegService;
use crate::notifications::NotificationService;
use crate::queue::QueueManager;
use crate::scheduler::SchedulerService;
use crate::settings::SettingsManager;

#[derive(Clone)]
pub struct AppState {
    pub db: Database,
    pub engine: DownloadEngine,
    pub queue_mgr: QueueManager,
    pub scheduler: SchedulerService,
    pub settings_mgr: SettingsManager,
    pub ffmpeg: FFmpegService,
    pub notifications: NotificationService,
    pub extractor: ExtractorService,
}
