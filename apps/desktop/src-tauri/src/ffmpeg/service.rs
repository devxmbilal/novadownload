use crate::errors::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use tokio::process::Command;
use tracing::info;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FFmpegInfo {
    pub is_available: bool,
    pub version: Option<String>,
    pub binary_path: Option<String>,
}

#[derive(Clone, Default)]
pub struct FFmpegService {
    custom_path: Option<String>,
}

impl FFmpegService {
    pub fn new(custom_path: Option<String>) -> Self {
        Self { custom_path }
    }

    pub async fn detect(&self) -> FFmpegInfo {
        let binary = self.custom_path.as_deref().unwrap_or("ffmpeg");
        
        match Command::new(binary).arg("-version").output().await {
            Ok(output) if output.status.success() => {
                let stdout = String::from_utf8_lossy(&output.stdout);
                let first_line = stdout.lines().next().unwrap_or("ffmpeg unknown version").to_string();
                FFmpegInfo {
                    is_available: true,
                    version: Some(first_line),
                    binary_path: Some(binary.to_string()),
                }
            }
            _ => FFmpegInfo {
                is_available: false,
                version: None,
                binary_path: None,
            },
        }
    }

    pub async fn merge_video_audio(
        &self,
        video_path: &str,
        audio_path: &str,
        output_path: &str,
    ) -> AppResult<()> {
        let binary = self.custom_path.as_deref().unwrap_or("ffmpeg");
        info!("Running FFmpeg merge: video={}, audio={}, output={}", video_path, audio_path, output_path);

        let output = Command::new(binary)
            .args([
                "-y",
                "-i", video_path,
                "-i", audio_path,
                "-c", "copy",
                "-map", "0:v:0",
                "-map", "1:a:0",
                output_path,
            ])
            .output()
            .await
            .map_err(|e| AppError::FFmpeg(format!("Failed to spawn ffmpeg: {}", e)))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(AppError::FFmpeg(format!("FFmpeg merge failed: {}", stderr)));
        }

        Ok(())
    }

    pub async fn extract_audio(
        &self,
        input_path: &str,
        output_path: &str,
    ) -> AppResult<()> {
        let binary = self.custom_path.as_deref().unwrap_or("ffmpeg");
        let output = Command::new(binary)
            .args([
                "-y",
                "-i", input_path,
                "-vn",
                "-acodec", "libmp3lame",
                "-q:a", "2",
                output_path,
            ])
            .output()
            .await
            .map_err(|e| AppError::FFmpeg(format!("Failed to spawn ffmpeg: {}", e)))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(AppError::FFmpeg(format!("FFmpeg audio extraction failed: {}", stderr)));
        }

        Ok(())
    }
}
