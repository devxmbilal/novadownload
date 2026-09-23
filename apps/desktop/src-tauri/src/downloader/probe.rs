use crate::errors::{AppError, AppResult};
use crate::filesystem::{detect_category, sanitize_filename};
use crate::models::UrlProbeResult;
use reqwest::header::{HeaderMap, ACCEPT_RANGES, CONTENT_DISPOSITION, CONTENT_LENGTH, CONTENT_TYPE, ETAG, LAST_MODIFIED};
use std::time::Duration;
use url::Url;

pub async fn probe_url(client: &reqwest::Client, target_url: &str) -> AppResult<UrlProbeResult> {
    let parsed_url = Url::parse(target_url).map_err(|e| AppError::InvalidUrl(e.to_string()))?;
    
    // Attempt HEAD request first with a 10-second timeout
    let mut file_name = None;
    let mut file_size = None;
    let mut mime_type = None;
    let mut accept_ranges = false;
    let mut etag = None;
    let mut last_modified = None;

    let head_resp = client
        .head(target_url)
        .timeout(Duration::from_secs(10))
        .send()
        .await;

    match head_resp {
        Ok(resp) if resp.status().is_success() => {
            extract_headers_info(
                resp.headers(),
                &mut file_name,
                &mut file_size,
                &mut mime_type,
                &mut accept_ranges,
                &mut etag,
                &mut last_modified,
            );
        }
        _ => {
            // Fallback: try GET with Range 0-0 or regular GET to check headers without downloading entire body
            if let Ok(resp) = client
                .get(target_url)
                .header("Range", "bytes=0-0")
                .timeout(Duration::from_secs(10))
                .send()
                .await
            {
                if resp.status().as_u16() == 206 {
                    accept_ranges = true;
                    // Check Content-Range header for total length: "bytes 0-0/123456"
                    if let Some(cr) = resp.headers().get("Content-Range").and_then(|v| v.to_str().ok()) {
                        if let Some(total_str) = cr.split('/').last() {
                            if let Ok(total) = total_str.trim().parse::<i64>() {
                                file_size = Some(total);
                            }
                        }
                    }
                }
                extract_headers_info(
                    resp.headers(),
                    &mut file_name,
                    &mut file_size,
                    &mut mime_type,
                    &mut accept_ranges,
                    &mut etag,
                    &mut last_modified,
                );
            }
        }
    }

    // Determine fallback filename from URL path if not provided in headers
    let derived_filename = if let Some(name) = file_name {
        sanitize_filename(&name)
    } else {
        extract_filename_from_url(&parsed_url)
    };

    let category = detect_category(&derived_filename, mime_type.as_deref()).to_string();

    Ok(UrlProbeResult {
        url: target_url.to_string(),
        file_name: derived_filename,
        file_size,
        mime_type,
        accept_ranges,
        suggested_category: category,
        etag,
        last_modified,
    })
}

fn extract_headers_info(
    headers: &HeaderMap,
    file_name: &mut Option<String>,
    file_size: &mut Option<i64>,
    mime_type: &mut Option<String>,
    accept_ranges: &mut bool,
    etag: &mut Option<String>,
    last_modified: &mut Option<String>,
) {
    if let Some(ar) = headers.get(ACCEPT_RANGES).and_then(|v| v.to_str().ok()) {
        if ar.to_lowercase().contains("bytes") {
            *accept_ranges = true;
        }
    }

    if file_size.is_none() {
        if let Some(cl) = headers.get(CONTENT_LENGTH).and_then(|v| v.to_str().ok()) {
            if let Ok(size) = cl.parse::<i64>() {
                *file_size = Some(size);
            }
        }
    }

    if let Some(ct) = headers.get(CONTENT_TYPE).and_then(|v| v.to_str().ok()) {
        let clean_type = ct.split(';').next().unwrap_or(ct).trim().to_string();
        *mime_type = Some(clean_type);
    }

    if let Some(cd) = headers.get(CONTENT_DISPOSITION).and_then(|v| v.to_str().ok()) {
        if let Some(fn_extracted) = parse_content_disposition_filename(cd) {
            *file_name = Some(fn_extracted);
        }
    }

    if let Some(e) = headers.get(ETAG).and_then(|v| v.to_str().ok()) {
        *etag = Some(e.trim_matches('"').to_string());
    }

    if let Some(lm) = headers.get(LAST_MODIFIED).and_then(|v| v.to_str().ok()) {
        *last_modified = Some(lm.to_string());
    }
}

fn parse_content_disposition_filename(disposition: &str) -> Option<String> {
    // Check filename*=UTF-8''... or filename="..."
    for part in disposition.split(';') {
        let part = part.trim();
        if part.to_lowercase().starts_with("filename*=") {
            if let Some(val) = part.split('=').nth(1) {
                let clean = val.trim_matches('"');
                if clean.to_lowercase().starts_with("utf-8''") {
                    let decoded = urlencoding_decode(&clean[7..]);
                    return Some(decoded);
                }
            }
        } else if part.to_lowercase().starts_with("filename=") {
            if let Some(val) = part.split('=').nth(1) {
                return Some(val.trim_matches('"').trim().to_string());
            }
        }
    }
    None
}

fn extract_filename_from_url(url: &Url) -> String {
    let path = url.path();
    let segment = path.split('/').filter(|s| !s.is_empty()).last();
    if let Some(name) = segment {
        let decoded = urlencoding_decode(name);
        sanitize_filename(&decoded)
    } else {
        "download_file".to_string()
    }
}

fn urlencoding_decode(input: &str) -> String {
    url::form_urlencoded::parse(input.as_bytes())
        .map(|(k, _)| k.to_string())
        .collect::<Vec<_>>()
        .join("")
}
