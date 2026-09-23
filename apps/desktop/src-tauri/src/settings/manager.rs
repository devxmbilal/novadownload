use crate::database::Database;
use crate::errors::{AppError, AppResult};
use crate::models::AppSettings;
use std::sync::Arc;
use tokio::sync::RwLock;
use tracing::info;

#[derive(Clone)]
pub struct SettingsManager {
    db: Database,
    cache: Arc<RwLock<AppSettings>>,
}

impl SettingsManager {
    pub async fn new(db: Database) -> Self {
        let default_settings = AppSettings::default();
        let loaded = match db.get_setting("app_settings").await {
            Ok(Some(json_str)) => serde_json::from_str::<AppSettings>(&json_str).unwrap_or(default_settings),
            _ => {
                let json_str = serde_json::to_string(&default_settings).unwrap_or_default();
                let _ = db.set_setting("app_settings", &json_str).await;
                default_settings
            }
        };

        Self {
            db,
            cache: Arc::new(RwLock::new(loaded)),
        }
    }

    pub async fn get_settings(&self) -> AppSettings {
        self.cache.read().await.clone()
    }

    pub async fn update_settings(&self, new_settings: AppSettings) -> AppResult<AppSettings> {
        let json_str = serde_json::to_string(&new_settings)
            .map_err(|e| AppError::Serialization(e.to_string()))?;
        
        self.db.set_setting("app_settings", &json_str).await?;
        *self.cache.write().await = new_settings.clone();
        
        info!("Application settings updated");
        Ok(new_settings)
    }
}
