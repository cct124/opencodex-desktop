//! Headless integration check using the same Windows launch boundary as the app.
//! All proxy/client data belongs to the existing fixture scripts in .tmp/desktop.
#[cfg(windows)]
#[allow(dead_code)]
#[path = "../src/windows_runtime.rs"]
mod windows_runtime;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    #[cfg(windows)]
    if let Some(code) = windows_runtime::enter_desktop_environment()? {
        std::process::exit(code as i32);
    }
    let repo = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .canonicalize()?;
    let kind = std::env::args()
        .nth(1)
        .unwrap_or_else(|| "persistent".into());
    let script = match kind.as_str() {
        "persistent" => "persistent-smoke.ts",
        "package" => "package-smoke.ts",
        _ => return Err("expected persistent or package".into()),
    };
    let bun = if cfg!(windows) { "bun.exe" } else { "bun" };
    let mut command = std::process::Command::new(repo.join("node_modules/bun/bin").join(bun));
    command
        .arg(repo.join("desktop-fork/scripts").join(script))
        .current_dir(&repo);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    let output = command.output()?;
    let mut log = Vec::new();
    #[cfg(windows)]
    log.extend(format!("packaged runtime: {}\n", windows_runtime::is_packaged()?).as_bytes());
    log.extend(output.stdout);
    log.extend(output.stderr);
    let reports = repo.join(".tmp/desktop");
    std::fs::create_dir_all(&reports)?;
    std::fs::write(reports.join(format!("runtime-probe-{kind}.log")), log)?;
    std::process::exit(output.status.code().unwrap_or(1));
}
