use crate::ffmpeg::FFmpegInfo;
use crate::state::AppState;
use tauri::State;

#[tauri::command]
pub async fn detect_ffmpeg(state: State<'_, AppState>) -> Result<FFmpegInfo, String> {
    Ok(state.ffmpeg.detect().await)
}

#[tauri::command]
pub async fn merge_media(
    state: State<'_, AppState>,
    video_path: String,
    audio_path: String,
    output_path: String,
) -> Result<(), String> {
    state
        .ffmpeg
        .merge_video_audio(&video_path, &audio_path, &output_path)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn extract_audio(
    state: State<'_, AppState>,
    input_path: String,
    output_path: String,
) -> Result<(), String> {
    state
        .ffmpeg
        .extract_audio(&input_path, &output_path)
        .await
        .map_err(|e| e.to_string())
}
