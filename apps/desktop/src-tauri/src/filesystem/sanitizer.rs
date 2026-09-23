use std::path::{Path, PathBuf};

pub fn sanitize_filename(name: &str) -> String {
    let mut clean = name
        .chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' | '\0'..='\x1f' => '_',
            _ => c,
        })
        .collect::<String>()
        .trim()
        .trim_matches('.')
        .to_string();

    if clean.is_empty() {
        clean = "download".to_string();
    }

    // Windows reserved filenames check
    let upper = clean.to_uppercase();
    let base = upper.split('.').next().unwrap_or("");
    let reserved = [
        "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
        "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
    ];

    if reserved.contains(&base) {
        clean = format!("_{}", clean);
    }

    clean
}

pub fn get_unique_filepath(directory: &Path, filename: &str) -> PathBuf {
    let path = directory.join(filename);
    if !path.exists() {
        return path;
    }

    let stem = Path::new(filename)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("download");
    let ext = Path::new(filename)
        .extension()
        .and_then(|s| s.to_str())
        .map(|e| format!(".{}", e))
        .unwrap_or_default();

    let mut counter = 1;
    loop {
        let new_name = format!("{} ({}){}", stem, counter, ext);
        let candidate = directory.join(new_name);
        if !candidate.exists() {
            return candidate;
        }
        counter += 1;
    }
}

pub fn safe_join(base_dir: &Path, user_path: &str) -> Result<PathBuf, String> {
    let clean_name = sanitize_filename(user_path);
    let full_path = base_dir.join(clean_name);
    
    // Ensure the resulting path starts with base_dir (prevent path traversal)
    if full_path.starts_with(base_dir) {
        Ok(full_path)
    } else {
        Err("Path traversal detected".to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    #[test]
    fn test_sanitize_filename_basic() {
        assert_eq!(sanitize_filename("valid_file.zip"), "valid_file.zip");
        assert_eq!(sanitize_filename("bad/name\\with:chars?.mp4"), "bad_name_with_chars_.mp4");
        assert_eq!(sanitize_filename("..."), "download");
    }

    #[test]
    fn test_sanitize_windows_reserved() {
        assert_eq!(sanitize_filename("CON.txt"), "_CON.txt");
        assert_eq!(sanitize_filename("aux.json"), "_aux.json");
        assert_eq!(sanitize_filename("nul"), "_nul");
    }

    #[test]
    fn test_safe_join() {
        let base = Path::new("C:\\Users\\User\\Downloads");
        let safe = safe_join(base, "normal_file.txt");
        assert!(safe.is_ok());

        let attack = safe_join(base, "..\\..\\evil.exe");
        assert!(attack.is_ok()); // Because sanitize_filename turns ..\\..\\ into ____
        let sanitized = attack.unwrap();
        assert!(sanitized.starts_with(base));
    }
}

