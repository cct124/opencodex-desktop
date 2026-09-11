#![cfg_attr(target_os = "windows", windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use std::{
    fs::{self, OpenOptions},
    io::{BufRead, BufReader, Write},
    path::PathBuf,
    process::{Child, ChildStdin, Command, Stdio},
    sync::{
        atomic::{AtomicBool, AtomicI32, Ordering},
        Arc, Mutex,
    },
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_opener::OpenerExt;

#[derive(Clone, Serialize)]
struct Status {
    phase: String,
    message: String,
    log_path: String,
    page_loaded: bool,
}

struct DesktopState {
    status: Mutex<Status>,
    child: Mutex<Option<Child>>,
    input: Mutex<Option<ChildStdin>>,
    shutdown_at: Mutex<Option<Instant>>,
    exiting: AtomicBool,
    exit_code: AtomicI32,
}

impl Default for DesktopState {
    fn default() -> Self {
        Self {
            status: Mutex::new(Status {
                phase: "starting".into(),
                message: "正在启动项目内后端…".into(),
                log_path: String::new(),
                page_loaded: false,
            }),
            child: Mutex::new(None),
            input: Mutex::new(None),
            shutdown_at: Mutex::new(None),
            exiting: AtomicBool::new(false),
            exit_code: AtomicI32::new(0),
        }
    }
}

fn update_status(state: &DesktopState, phase: &str, message: &str) {
    let mut status = state.status.lock().unwrap();
    status.phase = phase.into();
    status.message = message.into();
    if phase == "loaded" {
        status.page_loaded = true;
    }
    // A non-secret local record also lets the development smoke check observe native page load.
    if !status.log_path.is_empty() {
        let path = PathBuf::from(&status.log_path).with_file_name("desktop-status.json");
        if let Ok(json) = serde_json::to_vec_pretty(&*status) {
            let _ = fs::write(path, json);
        }
    }
}

fn show_error(app: &tauri::AppHandle, state: &DesktopState, message: &str) {
    update_status(state, "error", message);
    if let Some(window) = app.get_webview_window("dashboard") {
        let _ = window.hide();
    }
    if let Some(window) = app.get_webview_window("launcher") {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn stop_backend(state: &DesktopState) {
    let mut requested = state.shutdown_at.lock().unwrap();
    if requested.is_some() {
        return;
    }
    *requested = Some(Instant::now());
    if let Some(mut input) = state.input.lock().unwrap().take() {
        let _ = input.write_all(b"shutdown\n");
        let _ = input.flush();
        // EOF is also a shutdown request, including if the desktop parent crashes.
    }
}

fn request_exit(app: &tauri::AppHandle, state: &DesktopState) {
    if state.exiting.swap(true, Ordering::SeqCst) {
        return;
    }
    update_status(state, "stopping", "正在停止后端并恢复开发配置…");
    if state.child.lock().unwrap().is_none() {
        app.exit(state.exit_code.load(Ordering::SeqCst));
        return;
    }
    stop_backend(state);
}

#[tauri::command]
fn desktop_status(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, Arc<DesktopState>>,
) -> Result<Status, String> {
    if window.label() != "launcher" {
        return Err("Only the local launcher may access desktop commands".into());
    }
    Ok(state.status.lock().unwrap().clone())
}

#[tauri::command]
fn desktop_quit(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<DesktopState>>,
) -> Result<(), String> {
    if window.label() != "launcher" {
        return Err("Only the local launcher may access desktop commands".into());
    }
    request_exit(&app, &state);
    Ok(())
}

#[derive(Deserialize)]
struct BackendEvent {
    #[serde(rename = "type")]
    kind: String,
    pid: u32,
    url: Option<String>,
    message: Option<String>,
}

fn backend_url(raw: &str) -> Option<tauri::Url> {
    let url = tauri::Url::parse(raw).ok()?;
    (url.scheme() == "http"
        && url.host_str() == Some("127.0.0.1")
        && url.port().is_some()
        && url.username().is_empty()
        && url.password().is_none()
        && url.path() == "/"
        && url.query().is_none()
        && url.fragment().is_none())
    .then_some(url)
}

fn open_dashboard(
    app: &tauri::AppHandle,
    state: Arc<DesktopState>,
    url: tauri::Url,
    session: &std::path::Path,
) -> tauri::Result<()> {
    let expected_origin = url.origin();
    let page_origin = url.origin();
    let navigation_app = app.clone();
    let external_app = app.clone();
    let page_app = app.clone();
    WebviewWindowBuilder::new(app, "dashboard", WebviewUrl::External(url))
        .title("OpenCodex Desktop · 开发预览（独立配置）")
        .inner_size(1320.0, 860.0)
        .min_inner_size(960.0, 640.0)
        .visible(false)
        .data_directory(session.join("webview"))
        .on_navigation(move |target| {
            if target.origin() == expected_origin {
                return true;
            }
            if matches!(target.scheme(), "http" | "https") {
                let _ = navigation_app
                    .opener()
                    .open_url(target.as_str(), None::<&str>);
            }
            false
        })
        .on_new_window(move |target, _features| {
            if matches!(target.scheme(), "http" | "https") {
                let _ = external_app
                    .opener()
                    .open_url(target.as_str(), None::<&str>);
            }
            tauri::webview::NewWindowResponse::Deny
        })
        .on_page_load(move |window, payload| {
            if payload.event() == tauri::webview::PageLoadEvent::Finished
                && payload.url().origin() == page_origin
                && !state.exiting.load(Ordering::SeqCst)
                && state.status.lock().unwrap().phase == "ready"
            {
                update_status(&state, "loaded", "原有管理界面已在桌面窗口加载。");
                let _ = window.show();
                let _ = window.set_focus();
                if let Some(launcher) = page_app.get_webview_window("launcher") {
                    let _ = launcher.hide();
                }
            }
        })
        .build()?;
    Ok(())
}

fn start_backend(
    app: &tauri::AppHandle,
    state: Arc<DesktopState>,
) -> Result<(), Box<dyn std::error::Error>> {
    // M1 is a source-checkout preview. Distribution will supply a resource-root instead.
    let repo = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .canonicalize()?;
    let bun = repo.join("node_modules/bun/bin/bun.exe");
    if !bun.is_file() {
        return Err("缺少项目内 Bun，请先完成项目依赖安装。".into());
    }
    if !repo.join("gui/dist/index.html").is_file() {
        return Err("缺少管理界面，请先运行上游 build:gui。".into());
    }
    let session = repo.join(".tmp/desktop").join(format!(
        "session-{}-{}",
        std::process::id(),
        SystemTime::now().duration_since(UNIX_EPOCH)?.as_nanos()
    ));
    fs::create_dir_all(&session)?;
    let log_path = session.join("backend.log");
    let log = OpenOptions::new()
        .create_new(true)
        .append(true)
        .open(&log_path)?;
    state.status.lock().unwrap().log_path = log_path.display().to_string();
    update_status(&state, "starting", "正在启动项目内后端并校验进程身份…");
    let mut command = Command::new(&bun);
    command
        .arg(repo.join("desktop/runtime/entry.ts"))
        .arg(&session)
        .current_dir(&repo)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::from(log.try_clone()?));
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    let mut child = command.spawn()?;
    let pid = child.id();
    let output = child.stdout.take().ok_or("Missing backend stdout")?;
    *state.input.lock().unwrap() = child.stdin.take();
    *state.child.lock().unwrap() = Some(child);

    let output_app = app.clone();
    let output_state = state.clone();
    thread::spawn(move || {
        let mut log = log;
        for line in BufReader::new(output).lines() {
            let Ok(line) = line else { break };
            let _ = writeln!(log, "{line}");
            let Some(raw) = line.strip_prefix("OCX_DESKTOP_EVENT ") else {
                continue;
            };
            let Ok(event) = serde_json::from_str::<BackendEvent>(raw) else {
                continue;
            };
            if event.pid != pid
                || output_state.exiting.load(Ordering::SeqCst)
                || output_state.child.lock().unwrap().is_none()
            {
                continue;
            }
            match event.kind.as_str() {
                "ready" => {
                    let Some(url) = event.url.as_deref().and_then(backend_url) else {
                        continue;
                    };
                    update_status(&output_state, "ready", "后端已就绪，正在加载管理界面…");
                    if let Err(error) =
                        open_dashboard(&output_app, output_state.clone(), url, &session)
                    {
                        show_error(
                            &output_app,
                            &output_state,
                            &format!("无法创建管理窗口：{error}"),
                        );
                        stop_backend(&output_state);
                    }
                }
                "error" => show_error(
                    &output_app,
                    &output_state,
                    event.message.as_deref().unwrap_or("后端启动失败。"),
                ),
                _ => {}
            }
        }
    });

    let monitor_app = app.clone();
    thread::spawn(move || loop {
        let deadline_exceeded = state
            .shutdown_at
            .lock()
            .unwrap()
            .is_some_and(|at| at.elapsed() > Duration::from_secs(15));
        let result = {
            let mut slot = state.child.lock().unwrap();
            let Some(child) = slot.as_mut() else { break };
            if deadline_exceeded {
                let _ = child.kill();
            }
            match child.try_wait() {
                Ok(Some(exit)) => {
                    *slot = None;
                    Some(exit.to_string())
                }
                Err(error) => {
                    let _ = child.kill();
                    let _ = child.wait();
                    *slot = None;
                    Some(error.to_string())
                }
                Ok(None) => None,
            }
        };
        if let Some(result) = result {
            state.input.lock().unwrap().take();
            if state.exiting.load(Ordering::SeqCst) {
                update_status(&state, "stopped", &format!("开发后端已退出（{result}）。"));
                monitor_app.exit(state.exit_code.load(Ordering::SeqCst));
            } else if state.status.lock().unwrap().phase != "error" {
                show_error(
                    &monitor_app,
                    &state,
                    &format!("后端已退出（{result}）。请查看日志，关闭应用后重新打开。"),
                );
            }
            break;
        }
        thread::sleep(Duration::from_millis(100));
    });
    Ok(())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(Arc::new(DesktopState::default()))
        .invoke_handler(tauri::generate_handler![desktop_status, desktop_quit])
        .setup(|app| {
            WebviewWindowBuilder::new(app, "launcher", WebviewUrl::App("index.html".into()))
                .title("OpenCodex Desktop · 开发预览")
                .inner_size(640.0, 470.0)
                .resizable(false)
                .on_navigation(|url| {
                    url.scheme() == "tauri" || url.host_str() == Some("tauri.localhost")
                })
                .build()?;
            let state = app.state::<Arc<DesktopState>>().inner().clone();
            if let Err(error) = start_backend(app.handle(), state.clone()) {
                show_error(app.handle(), &state, &error.to_string());
            }
            if cfg!(debug_assertions) && std::env::args().any(|arg| arg == "--smoke-test") {
                let smoke_app = app.handle().clone();
                thread::spawn(move || {
                    let deadline = Instant::now() + Duration::from_secs(75);
                    loop {
                        let phase = state.status.lock().unwrap().phase.clone();
                        if phase == "loaded" {
                            thread::sleep(Duration::from_secs(2));
                            break;
                        }
                        if phase == "error" || Instant::now() >= deadline {
                            state.exit_code.store(1, Ordering::SeqCst);
                            break;
                        }
                        thread::sleep(Duration::from_millis(100));
                    }
                    request_exit(&smoke_app, &state);
                });
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                request_exit(
                    window.app_handle(),
                    window.state::<Arc<DesktopState>>().inner(),
                );
            }
        })
        .build(tauri::generate_context!())
        .expect("Cannot initialize OpenCodex Desktop")
        .run(|app, event| {
            if let tauri::RunEvent::ExitRequested { api, .. } = event {
                let state = app.state::<Arc<DesktopState>>();
                if !state.exiting.load(Ordering::SeqCst) {
                    api.prevent_exit();
                    request_exit(app, &state);
                }
            }
        });
}

#[cfg(test)]
mod tests {
    use super::backend_url;

    #[test]
    fn only_owned_loopback_origins_can_become_the_dashboard() {
        assert!(backend_url("http://127.0.0.1:43123/").is_some());
        for url in [
            "https://example.com/",
            "http://localhost:43123/",
            "file:///tmp/a",
            "http://user@127.0.0.1:43123/",
            "http://127.0.0.1:43123/?redirect=external",
        ] {
            assert!(backend_url(url).is_none(), "{url}");
        }
    }
}
