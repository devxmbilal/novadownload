use crate::models::AppSettings;
use crate::state::AppState;
use tauri::State;

#[tauri::command]
pub async fn get_settings(state: State<'_, AppState>) -> Result<AppSettings, String> {
    Ok(state.settings_mgr.get_settings().await)
}

#[tauri::command]
pub async fn update_settings(
    state: State<'_, AppState>,
    settings: AppSettings,
) -> Result<AppSettings, String> {
    // Update rate limit in engine as well
    state.engine.set_global_speed_limit(settings.global_speed_limit);
    state
        .settings_mgr
        .update_settings(settings)
        .await
        .map_err(|e| e.to_string())
}
