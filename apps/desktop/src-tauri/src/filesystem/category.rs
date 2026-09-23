use std::path::Path;

pub fn detect_category(filename: &str, mime_type: Option<&str>) -> &'static str {
    let ext = Path::new(filename)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())
        .unwrap_or_default();

    let video_exts = ["mp4", "mkv", "webm", "avi", "mov", "wmv", "flv", "m4v", "3gp", "ts"];
    let music_exts = ["mp3", "wav", "flac", "aac", "ogg", "m4a", "wma", "opus"];
    let doc_exts = ["pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt", "rtf", "csv", "md", "epub"];
    let image_exts = ["jpg", "jpeg", "png", "gif", "bmp", "svg", "webp", "ico", "tiff", "avif"];
    let archive_exts = ["zip", "rar", "7z", "tar", "gz", "bz2", "xz", "iso", "dmg", "tgz"];
    let program_exts = ["exe", "msi", "bat", "sh", "apk", "appimage", "deb", "rpm"];

    if video_exts.contains(&ext.as_str()) || mime_type.map_or(false, |m| m.starts_with("video/")) {
        return "Videos";
    }
    if music_exts.contains(&ext.as_str()) || mime_type.map_or(false, |m| m.starts_with("audio/")) {
        return "Music";
    }
    if doc_exts.contains(&ext.as_str())
        || mime_type.map_or(false, |m| {
            m.starts_with("text/")
                || m.contains("pdf")
                || m.contains("word")
                || m.contains("sheet")
                || m.contains("document")
        })
    {
        return "Documents";
    }
    if image_exts.contains(&ext.as_str()) || mime_type.map_or(false, |m| m.starts_with("image/")) {
        return "Images";
    }
    if archive_exts.contains(&ext.as_str())
        || mime_type.map_or(false, |m| {
            m.contains("zip") || m.contains("compressed") || m.contains("tar") || m.contains("archive")
        })
    {
        return "Archives";
    }
    if program_exts.contains(&ext.as_str())
        || mime_type.map_or(false, |m| {
            m.contains("executable") || (m.contains("octet-stream") && (ext == "exe" || ext == "msi"))
        })
    {
        return "Programs";
    }

    "Other"
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_detect_category() {
        assert_eq!(detect_category("movie.mp4", None), "Videos");
        assert_eq!(detect_category("song.mp3", None), "Music");
        assert_eq!(detect_category("document.pdf", None), "Documents");
        assert_eq!(detect_category("photo.png", None), "Images");
        assert_eq!(detect_category("archive.zip", None), "Archives");
        assert_eq!(detect_category("setup.exe", None), "Programs");
        assert_eq!(detect_category("unknown.dat", None), "Other");
        assert_eq!(detect_category("stream", Some("video/mp4")), "Videos");
    }
}

