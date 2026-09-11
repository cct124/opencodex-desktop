use std::path::{Path, PathBuf};
#[cfg(not(debug_assertions))]
use tauri::Manager;

/// Release builds resolve their adjacent installed resources, never a developer checkout.
pub fn runtime_root(app: &tauri::AppHandle) -> Result<PathBuf, Box<dyn std::error::Error>> {
    #[cfg(debug_assertions)]
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..");
    #[cfg(not(debug_assertions))]
    let root = app.path().resource_dir()?.join("runtime");
    #[cfg(debug_assertions)]
    let _ = app;
    Ok(if root.exists() {
        root.canonicalize()?
    } else {
        root
    })
}

pub fn validate_root(root: &Path, version: &str, packaged: bool) -> Result<(), String> {
    for relative in [
        "node_modules/bun/bin/bun.exe",
        "desktop/runtime/entry.ts",
        "src/cli/index.ts",
        "gui/dist/index.html",
        "package.json",
    ] {
        if !root.join(relative).is_file() {
            return Err(format!(
                "应用资源缺失：{relative}。请重新安装完整的 OpenCodex Desktop。"
            ));
        }
    }
    let raw = std::fs::read(root.join("package.json")).map_err(|e| e.to_string())?;
    let package: serde_json::Value = serde_json::from_slice(&raw).map_err(|e| e.to_string())?;
    if package["version"].as_str() != Some(version) {
        return Err("桌面壳与后端版本不一致，请重新安装完整应用。".into());
    }
    if packaged {
        let raw =
            std::fs::read(root.join("desktop-manifest.json")).map_err(|_| "缺少安装资源清单。")?;
        let manifest: serde_json::Value =
            serde_json::from_slice(&raw).map_err(|e| e.to_string())?;
        if manifest["version"].as_str() != Some(version)
            || manifest["platform"].as_str() != Some("win32-x64")
        {
            return Err("安装资源清单与当前应用不匹配。".into());
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_missing_or_mixed_release_resources() {
        let root = std::env::temp_dir().join(format!("ocx-resources-{}", std::process::id()));
        std::fs::create_dir_all(&root).unwrap();
        assert!(validate_root(&root, "2.50.0", true).is_err());
        for relative in [
            "node_modules/bun/bin/bun.exe",
            "desktop/runtime/entry.ts",
            "src/cli/index.ts",
            "gui/dist/index.html",
        ] {
            let file = root.join(relative);
            std::fs::create_dir_all(file.parent().unwrap()).unwrap();
            std::fs::write(file, "fixture").unwrap();
        }
        std::fs::write(root.join("package.json"), r#"{"version":"2.50.0"}"#).unwrap();
        assert!(validate_root(&root, "2.51.0", false).is_err());
        assert!(validate_root(&root, "2.50.0", false).is_ok());
        assert!(validate_root(&root, "2.50.0", true).is_err());
        std::fs::write(
            root.join("desktop-manifest.json"),
            r#"{"version":"2.50.0","platform":"win32-x64"}"#,
        )
        .unwrap();
        assert!(validate_root(&root, "2.50.0", true).is_ok());
        std::fs::remove_dir_all(root).unwrap();
    }
}
