use std::{
    fs,
    path::PathBuf,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::Manager;

#[derive(Clone)]
pub struct Profile {
    pub persistent: bool,
    pub root: PathBuf,
    pub session: PathBuf,
    pub codex_home: PathBuf,
    pub source_config: PathBuf,
}

impl Profile {
    pub fn create(
        app: &tauri::AppHandle,
        repo: &std::path::Path,
    ) -> Result<Self, Box<dyn std::error::Error>> {
        #[cfg(debug_assertions)]
        if let Some(index) = std::env::args().position(|arg| arg == "--smoke-persistent") {
            let root = PathBuf::from(std::env::args().nth(index + 1).ok_or("missing test root")?)
                .canonicalize()?;
            let allowed = repo.join(".tmp/desktop").canonicalize()?;
            if root == allowed || !root.starts_with(&allowed) {
                return Err("persistent smoke root must stay in .tmp/desktop".into());
            }
            let session = root.join("runs").join(format!(
                "session-{}-{}",
                std::process::id(),
                SystemTime::now().duration_since(UNIX_EPOCH)?.as_nanos()
            ));
            fs::create_dir_all(&session)?;
            return Ok(Self {
                persistent: true,
                codex_home: root.join("client-fixture"),
                source_config: root.join("source-config.json"),
                root,
                session,
            });
        }
        let preview = cfg!(debug_assertions)
            && std::env::args().any(|arg| arg == "--preview" || arg.starts_with("--smoke-"));
        let name = format!(
            "session-{}-{}",
            std::process::id(),
            SystemTime::now().duration_since(UNIX_EPOCH)?.as_nanos()
        );
        let root = if preview {
            repo.join(".tmp/desktop").join(&name)
        } else {
            app.path().app_local_data_dir()?
        };
        fs::create_dir_all(&root)?;
        // Store the OS-resolved path, also used by Explorer and the backend.
        let root = dunce::canonicalize(root)?;
        let session = if preview {
            root.clone()
        } else {
            root.join("runs").join(name)
        };
        let home = app.path().home_dir()?;
        let codex_home = std::env::var_os("CODEX_HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|| home.join(".codex"));
        let source_config = std::env::var_os("OPENCODEX_HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|| home.join(".opencodex"))
            .join("config.json");
        fs::create_dir_all(&session)?;
        Ok(Self {
            persistent: !preview,
            root,
            session,
            codex_home,
            source_config,
        })
    }
}
