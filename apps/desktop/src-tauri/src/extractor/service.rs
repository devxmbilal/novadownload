use crate::errors::{AppError, AppResult};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::{AppHandle, Manager};
use tokio::io::AsyncWriteExt;
use tokio::process::Command;
use tracing::{error, info};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MediaFormat {
    pub format_id: String,
    pub format_note: Option<String>,
    pub ext: String,
    pub resolution: Option<String>,
    pub filesize: Option<i64>,
    pub filesize_approx: Option<i64>,
    pub tbr: Option<f64>,
    pub fps: Option<f64>,
    pub vcodec: Option<String>,
    pub acodec: Option<String>,
    pub has_video: bool,
    pub has_audio: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MediaInfo {
    pub id: String,
    pub title: String,
    pub url: String,
    pub thumbnail: Option<String>,
    pub duration: Option<f64>,
    pub uploader: Option<String>,
    pub extractor: String,
    pub formats: Vec<MediaFormat>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MediaDownloadRequest {
    pub url: String,
    pub format_id: String,
    pub is_audio_only: bool,
    pub directory: Option<String>,
    pub file_name: Option<String>,
    pub quality_label: Option<String>,
    pub thumbnail: Option<String>,
    pub file_size: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExtractorStatus {
    pub is_available: bool,
    pub binary_path: Option<String>,
    pub version: Option<String>,
}

#[derive(Clone, Default)]
pub struct ExtractorService {
    custom_path: Option<String>,
}

impl ExtractorService {
    pub fn new(custom_path: Option<String>) -> Self {
        Self { custom_path }
    }

    /// Check if a URL looks like a supported media website (YouTube, TikTok, Facebook, Dailymotion, etc.) or media stream
    pub fn is_media_url(url: &str) -> bool {
        let u = url.to_lowercase();
        u.contains("youtube.com")
            || u.contains("youtu.be")
            || u.contains("tiktok.com")
            || u.contains("facebook.com")
            || u.contains("fb.watch")
            || u.contains("instagram.com")
            || u.contains("twitter.com")
            || u.contains("x.com")
            || u.contains("vimeo.com")
            || u.contains("reddit.com")
            || u.contains("dailymotion.com")
            || u.contains("dai.ly")
            || u.contains("twitch.tv")
            || u.contains("soundcloud.com")
            || u.contains("bilibili.com")
            || u.contains("pinterest.com")
            || u.contains(".m3u8")
            || u.contains(".mpd")
    }

    /// Normalize streaming / player URLs (e.g. geo.dailymotion.com embed player -> canonical dailymotion video URL)
    pub fn normalize_url(url: &str) -> String {
        let trimmed = url.trim();

        // 1. Dailymotion geo player / embed URLs:
        // Examples:
        // https://geo.dailymotion.com/player/xtv3w.html?video=x8xyz12
        // https://geo.dailymotion.com/player.html?video=k12345
        // https://www.dailymotion.com/embed/video/x8xyz12
        // https://dai.ly/x8xyz12
        if trimmed.contains("dailymotion.com") || trimmed.contains("dai.ly") {
            // Check query string for video=... or videoId=...
            if let Some(pos) = trimmed.find("video=") {
                let rest = &trimmed[pos + 6..];
                let vid_id = rest.split('&').next().unwrap_or(rest).split('#').next().unwrap_or(rest);
                if !vid_id.is_empty() {
                    let clean_id = vid_id.trim_matches(|c: char| !c.is_alphanumeric());
                    if !clean_id.is_empty() {
                        return format!("https://www.dailymotion.com/video/{}", clean_id);
                    }
                }
            }

            if let Some(pos) = trimmed.find("videoId=") {
                let rest = &trimmed[pos + 8..];
                let vid_id = rest.split('&').next().unwrap_or(rest).split('#').next().unwrap_or(rest);
                if !vid_id.is_empty() {
                    let clean_id = vid_id.trim_matches(|c: char| !c.is_alphanumeric());
                    if !clean_id.is_empty() {
                        return format!("https://www.dailymotion.com/video/{}", clean_id);
                    }
                }
            }

            // Check path for /embed/video/x... or /video/x... or /dai.ly/x...
            if let Some(pos) = trimmed.find("/video/") {
                let rest = &trimmed[pos + 7..];
                let vid_id = rest.split('?').next().unwrap_or(rest).split('#').next().unwrap_or(rest);
                if !vid_id.is_empty() {
                    let clean_id = vid_id.trim_matches(|c: char| !c.is_alphanumeric());
                    if !clean_id.is_empty() {
                        return format!("https://www.dailymotion.com/video/{}", clean_id);
                    }
                }
            }

            if let Some(pos) = trimmed.find("dai.ly/") {
                let rest = &trimmed[pos + 7..];
                let vid_id = rest.split('?').next().unwrap_or(rest).split('#').next().unwrap_or(rest);
                if !vid_id.is_empty() {
                    let clean_id = vid_id.trim_matches(|c: char| !c.is_alphanumeric());
                    if !clean_id.is_empty() {
                        return format!("https://www.dailymotion.com/video/{}", clean_id);
                    }
                }
            }
        }

        trimmed.to_string()
    }

    /// Resolve path to yt-dlp executable
    pub async fn resolve_binary_path(&self, app: &AppHandle) -> Option<PathBuf> {
        if let Some(ref p) = self.custom_path {
            let path = PathBuf::from(p);
            if path.exists() {
                return Some(path);
            }
        }

        // 1. Check AppData / bin / yt-dlp.exe
        if let Ok(app_dir) = app.path().app_data_dir() {
            let app_bin = app_dir.join("bin").join("yt-dlp.exe");
            if app_bin.exists() {
                return Some(app_bin);
            }
        }

        // 2. Check AppLocalData / bin / yt-dlp.exe
        if let Some(data_dir) = dirs::data_dir() {
            let roaming_bin = data_dir.join("NovaDownload").join("bin").join("yt-dlp.exe");
            if roaming_bin.exists() {
                return Some(roaming_bin);
            }
        }

        // 3. Check system PATH
        if let Ok(output) = Command::new("yt-dlp").arg("--version").output().await {
            if output.status.success() {
                return Some(PathBuf::from("yt-dlp"));
            }
        }

        None
    }

    /// Get current extractor status (availability and version)
    pub async fn get_status(&self, app: &AppHandle) -> ExtractorStatus {
        if let Some(bin_path) = self.resolve_binary_path(app).await {
            let output = Command::new(&bin_path)
                .arg("--version")
                .output()
                .await;

            match output {
                Ok(out) if out.status.success() => {
                    let ver = String::from_utf8_lossy(&out.stdout).trim().to_string();
                    ExtractorStatus {
                        is_available: true,
                        binary_path: Some(bin_path.to_string_lossy().to_string()),
                        version: Some(ver),
                    }
                }
                _ => ExtractorStatus {
                    is_available: false,
                    binary_path: Some(bin_path.to_string_lossy().to_string()),
                    version: None,
                },
            }
        } else {
            ExtractorStatus {
                is_available: false,
                binary_path: None,
                version: None,
            }
        }
    }

    /// Automatically ensure yt-dlp.exe is downloaded and ready in AppData/bin
    pub async fn ensure_binary(&self, app: &AppHandle) -> AppResult<PathBuf> {
        if let Some(existing) = self.resolve_binary_path(app).await {
            return Ok(existing);
        }

        // Download official standalone yt-dlp.exe from GitHub
        let app_dir = app
            .path()
            .app_data_dir()
            .unwrap_or_else(|_| dirs::data_dir().unwrap_or_else(|| PathBuf::from(".")).join("NovaDownload"));

        let bin_dir = app_dir.join("bin");
        tokio::fs::create_dir_all(&bin_dir)
            .await
            .map_err(|e| AppError::FileSystem(e.to_string()))?;

        let dest = bin_dir.join("yt-dlp.exe");
        info!("Downloading yt-dlp standalone binary to {:?}", dest);

        let url = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe";
        let client = Client::builder()
            .timeout(std::time::Duration::from_secs(60))
            .build()
            .unwrap_or_default();

        let response = client
            .get(url)
            .send()
            .await
            .map_err(|e| AppError::Network(format!("Failed to download yt-dlp binary: {}", e)))?;

        if !response.status().is_success() {
            return Err(AppError::Network(format!(
                "Failed to download yt-dlp from GitHub: HTTP {}",
                response.status()
            )));
        }

        let bytes = response
            .bytes()
            .await
            .map_err(|e| AppError::Network(format!("Failed to read yt-dlp binary payload: {}", e)))?;

        let mut file = tokio::fs::File::create(&dest)
            .await
            .map_err(|e| AppError::FileSystem(e.to_string()))?;
        file.write_all(&bytes).await.map_err(|e| AppError::FileSystem(e.to_string()))?;
        file.flush().await.map_err(|e| AppError::FileSystem(e.to_string()))?;

        info!("Successfully downloaded and installed yt-dlp.exe at {:?}", dest);
        Ok(dest)
    }

    /// Extract media metadata and available formats for a video URL
    pub async fn extract_info(&self, app: &AppHandle, url: &str) -> AppResult<MediaInfo> {
        let bin_path = self.ensure_binary(app).await?;
        let normalized_url = Self::normalize_url(url);

        let output = Command::new(&bin_path)
            .args(&[
                "--dump-single-json",
                "--no-warnings",
                "--no-playlist",
                "--skip-download",
                &normalized_url,
            ])
            .output()
            .await
            .map_err(|e| AppError::Internal(format!("Failed to execute extractor: {}", e)))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            error!("yt-dlp error: {}", stderr);
            return Err(AppError::Internal(format!(
                "Failed to extract video information: {}",
                stderr.lines().next().unwrap_or("Unknown extractor error")
            )));
        }

        let json_str = String::from_utf8_lossy(&output.stdout);
        let raw: serde_json::Value = serde_json::from_str(&json_str)
            .map_err(|e| AppError::Internal(format!("Failed to parse extractor output: {}", e)))?;

        let id = raw["id"].as_str().unwrap_or("media").to_string();
        let title = raw["title"].as_str().unwrap_or("Untitled Video").to_string();
        let thumbnail = raw["thumbnail"].as_str().map(|s| s.to_string());
        let duration = raw["duration"].as_f64();
        let uploader = raw["uploader"].as_str().or_else(|| raw["channel"].as_str()).map(|s| s.to_string());
        let extractor = raw["extractor_key"].as_str().or_else(|| raw["extractor"].as_str()).unwrap_or("generic").to_string();

        let mut formats: Vec<MediaFormat> = Vec::new();
        if let Some(raw_formats) = raw["formats"].as_array() {
            // Check if there are standard direct progressive / DASH formats (protocol http/https)
            let has_direct_formats = raw_formats.iter().any(|f| {
                let proto = f["protocol"].as_str().unwrap_or("");
                let fid = f["format_id"].as_str().unwrap_or("");
                (proto == "https" || proto == "http") && !fid.starts_with("sb")
            });

            for f in raw_formats {
                let format_id = match f["format_id"].as_str() {
                    Some(id) => id.to_string(),
                    None => continue,
                };

                // Skip storyboard / preview thumbnail formats
                if format_id.starts_with("sb") {
                    continue;
                }

                let protocol = f["protocol"].as_str().unwrap_or("https");
                let format_note = f["format_note"].as_str().map(|s| s.to_string());
                let is_m3u8 = protocol.contains("m3u8");
                let is_premium = format_note.as_deref().map(|n| n.to_lowercase().contains("premium")).unwrap_or(false);

                // If direct http/https formats exist, skip HLS/m3u8 manifests and premium variants
                // which have bloated bitrates and lack real stream filesizes
                if has_direct_formats && (is_m3u8 || is_premium) {
                    continue;
                }

                let ext = f["ext"].as_str().unwrap_or("mp4").to_string();
                let vcodec = f["vcodec"].as_str().filter(|&v| v != "none").map(|s| s.to_string());
                let acodec = f["acodec"].as_str().filter(|&a| a != "none").map(|s| s.to_string());
                let has_video = vcodec.is_some();
                let has_audio = acodec.is_some();

                // Skip formats that have neither video nor audio
                if !has_video && !has_audio {
                    continue;
                }

                let resolution = f["resolution"]
                    .as_str()
                    .map(|s| s.to_string())
                    .or_else(|| {
                        if let (Some(w), Some(h)) = (f["width"].as_i64(), f["height"].as_i64()) {
                            Some(format!("{}x{}", w, h))
                        } else if let Some(h) = f["height"].as_i64() {
                            Some(format!("{}p", h))
                        } else {
                            None
                        }
                    });

                let filesize = f["filesize"].as_i64();
                let mut filesize_approx = f["filesize_approx"].as_i64();
                let tbr = f["tbr"].as_f64();
                let fps = f["fps"].as_f64();

                if filesize.is_none() && filesize_approx.is_none() {
                    let bitrate = tbr
                        .or_else(|| {
                            let vbr = f["vbr"].as_f64().unwrap_or(0.0);
                            let abr = f["abr"].as_f64().unwrap_or(0.0);
                            if vbr + abr > 0.0 {
                                Some(vbr + abr)
                            } else {
                                None
                            }
                        })
                        .or_else(|| f["vbr"].as_f64())
                        .or_else(|| f["abr"].as_f64());

                    if let (Some(br), Some(dur)) = (bitrate, duration) {
                        if br > 0.0 && dur > 0.0 {
                            // Standard kbps to bytes: (br * 1000.0 / 8.0) * dur
                            filesize_approx = Some(((br * 1000.0 / 8.0) * dur) as i64);
                        }
                    }
                }

                formats.push(MediaFormat {
                    format_id,
                    format_note,
                    ext,
                    resolution,
                    filesize,
                    filesize_approx,
                    tbr,
                    fps,
                    vcodec,
                    acodec,
                    has_video,
                    has_audio,
                });
            }
        }

        // Calculate standard audio stream size to combine with video-only streams (e.g. YouTube DASH)
        // yt-dlp by default selects standard audio stream ~128kbps (e.g. itag 140 m4a or 251 opus)
        let standard_audio_size = formats
            .iter()
            .filter(|f| f.has_audio && !f.has_video)
            .filter_map(|f| {
                let sz = f.filesize.or(f.filesize_approx).unwrap_or(0);
                if sz > 0 {
                    // Check if audio bitrate is standard (e.g. <= 256kbps or reasonable)
                    let abr = f.tbr.unwrap_or(128.0);
                    Some((abr, sz))
                } else {
                    None
                }
            })
            // Prefer audio around 128-160kbps, which matches yt-dlp default bestaudio
            .min_by(|a, b| {
                let diff_a = (a.0 - 128.0).abs();
                let diff_b = (b.0 - 128.0).abs();
                diff_a.partial_cmp(&diff_b).unwrap_or(std::cmp::Ordering::Equal)
            })
            .map(|(_, sz)| sz)
            .unwrap_or(0);

        if standard_audio_size > 0 {
            for f in &mut formats {
                // ONLY add audio size if this format has video and DOES NOT already have audio
                if f.has_video && !f.has_audio {
                    if let Some(ref mut sz) = f.filesize {
                        *sz += standard_audio_size;
                    } else if let Some(ref mut approx) = f.filesize_approx {
                        *approx += standard_audio_size;
                    } else if duration.is_some() {
                        f.filesize_approx = Some(standard_audio_size);
                    }
                }
            }
        }

        Ok(MediaInfo {
            id,
            title,
            url: url.to_string(),
            thumbnail,
            duration,
            uploader,
            extractor,
            formats,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_media_url() {
        assert!(ExtractorService::is_media_url("https://www.youtube.com/watch?v=dQw4w9WgXcQ"));
        assert!(ExtractorService::is_media_url("https://youtu.be/dQw4w9WgXcQ"));
        assert!(ExtractorService::is_media_url("https://vm.tiktok.com/ZM8abc/"));
        assert!(ExtractorService::is_media_url("https://twitter.com/user/status/123456789"));
        assert!(ExtractorService::is_media_url("https://x.com/user/status/123456789"));
        assert!(ExtractorService::is_media_url("https://vimeo.com/76979871"));
        assert!(!ExtractorService::is_media_url("https://example.com/file.zip"));
        assert!(!ExtractorService::is_media_url("http://localhost:3000/download/100mb"));
    }
}
