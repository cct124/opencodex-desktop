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

pub fn bun_relative() -> &'static str {
    if cfg!(windows) {
        "node_modules/bun/bin/bun.exe"
    } else {
        "node_modules/bun/bin/bun"
    }
}

fn package_platform() -> String {
    let os = if cfg!(windows) { "win32" } else { "darwin" };
    let arch = if cfg!(target_arch = "aarch64") {
        "arm64"
    } else {
        "x64"
    };
    format!("{os}-{arch}")
}

pub fn validate_root(
    root: &Path,
    desktop_version: &str,
    runtime_version: &str,
    packaged: bool,
) -> Result<(), String> {
    for relative in [
        bun_relative(),
        "desktop-fork/runtime/entry.ts",
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
    if package["version"].as_str() != Some(runtime_version) {
        return Err("后端资源与此桌面构建所需版本不一致，请重新安装完整应用。".into());
    }
    if packaged {
        let raw =
            std::fs::read(root.join("desktop-manifest.json")).map_err(|_| "缺少安装资源清单。")?;
        let manifest: serde_json::Value =
            serde_json::from_slice(&raw).map_err(|e| e.to_string())?;
        if manifest["format"].as_u64() != Some(2)
            || manifest["desktopVersion"].as_str() != Some(desktop_version)
            || manifest["runtimeVersion"].as_str() != Some(runtime_version)
            || manifest["platform"].as_str() != Some(package_platform().as_str())
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
        assert!(validate_root(&root, "0.1.0", "2.50.0", true).is_err());
        for relative in [
            bun_relative(),
            "desktop-fork/runtime/entry.ts",
            "src/cli/index.ts",
            "gui/dist/index.html",
        ] {
            let file = root.join(relative);
            std::fs::create_dir_all(file.parent().unwrap()).unwrap();
            std::fs::write(file, "fixture").unwrap();
        }
        std::fs::write(root.join("package.json"), r#"{"version":"2.50.0"}"#).unwrap();
        assert!(validate_root(&root, "0.1.0", "2.51.0", false).is_err());
        assert!(validate_root(&root, "0.1.0", "2.50.0", false).is_ok());
        assert!(validate_root(&root, "0.1.0", "2.50.0", true).is_err());
        std::fs::write(
            root.join("desktop-manifest.json"),
            serde_json::json!({"format":2, "desktopVersion":"0.1.0", "runtimeVersion":"2.50.0", "platform":package_platform()}).to_string(),
        )
        .unwrap();
        assert!(validate_root(&root, "0.1.0", "2.50.0", true).is_ok());
        assert!(validate_root(&root, "0.2.0", "2.50.0", true).is_err());
        assert!(validate_root(&root, "0.1.0", "2.51.0", true).is_err());
        std::fs::write(root.join("desktop-manifest.json"), serde_json::json!({"format":2, "desktopVersion":"0.1.0", "runtimeVersion":"2.50.0", "platform":"wrong-platform"}).to_string()).unwrap();
        assert!(validate_root(&root, "0.1.0", "2.50.0", true).is_err());
        std::fs::remove_dir_all(root).unwrap();
    }
}
