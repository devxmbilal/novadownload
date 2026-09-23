use tauri::AppHandle;
use tauri_plugin_notification::NotificationExt;

#[derive(Clone, Default)]
pub struct NotificationService;

impl NotificationService {
    pub fn new() -> Self {
        Self
    }

    pub fn notify(&self, app: &AppHandle, title: &str, body: &str) {
        let _ = app
            .notification()
            .builder()
            .title(title)
            .body(body)
            .show();
    }
}
