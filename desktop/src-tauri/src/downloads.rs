use std::{
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::Manager;

pub fn directory(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let state = app.state::<crate::DesktopState>();
    let path = if state.profile.persistent {
        app.path()
            .download_dir()
            .map_err(|e| e.to_string())?
            .join("OpenCodex Desktop")
    } else {
        state.profile.root.join("downloads")
    };
    std::fs::create_dir_all(&path).map_err(|e| e.to_string())?;
    Ok(path)
}

pub fn destination(directory: &Path, suggested: &Path) -> PathBuf {
    let name = suggested
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("download");
    let safe: String = name
        .chars()
        .take(120)
        .map(|c| {
            if c.is_control() || "<>:\"/\\|?*".contains(c) {
                '_'
            } else {
                c
            }
        })
        .collect();
    let safe = safe.trim_end_matches(['.', ' ']);
    let id = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    // The prefix also prevents Windows device names (CON, NUL, ...) and collisions.
    directory.join(format!(
        "{id}-{}",
        if safe.is_empty() { "download" } else { safe }
    ))
}

pub fn allowed_url(url: &tauri::Url, origin: &str) -> bool {
    url.origin().ascii_serialization() == origin
        || (url.scheme() == "blob" && url.as_str().starts_with(&format!("blob:{origin}/")))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn downloads_cannot_choose_an_external_origin_or_parent_path() {
        let origin = "http://127.0.0.1:45000";
        for text in [
            "http://127.0.0.1:45000/export",
            "blob:http://127.0.0.1:45000/id",
        ] {
            assert!(allowed_url(&tauri::Url::parse(text).unwrap(), origin));
        }
        for text in [
            "file:///C:/x",
            "https://example.com/x",
            "blob:http://127.0.0.1:45001/id",
        ] {
            assert!(!allowed_url(&tauri::Url::parse(text).unwrap(), origin));
        }
        let root = std::env::temp_dir().join("downloads");
        for name in [
            "../../secret.txt",
            "CON",
            "a.txt:stream",
            "export.json",
            "数据.csv",
        ] {
            let file = destination(&root, Path::new(name));
            assert_eq!(file.parent(), Some(root.as_path()));
            assert!(!file.file_name().unwrap().to_string_lossy().contains(':'));
        }
    }
}
