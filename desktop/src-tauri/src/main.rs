#![cfg_attr(target_os = "windows", windows_subsystem = "windows")]

mod backend;
mod lifecycle;
mod profile;
#[cfg(debug_assertions)]
mod smoke;

use lifecycle::{Completion, Intent, Lifecycle, Phase};
use serde::Serialize;
use std::{
    fs,
    path::PathBuf,
    sync::{mpsc::Sender, Mutex},
    thread,
    time::Duration,
};
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, WebviewUrl, WebviewWindowBuilder,
};
use tauri_plugin_opener::OpenerExt;

#[derive(Clone, Serialize)]
struct Status {
    phase: Phase,
    message: String,
    log_path: String,
    page_loaded: bool,
    generation: u64,
    backend_pid: Option<u32>,
    dashboard_url: Option<String>,
    can_start: bool,
    can_stop: bool,
    can_restart: bool,
    activation_count: u32,
    codex_routing: String,
    routing_busy: bool,
    can_route: bool,
    persistent: bool,
    data_dir: String,
    codex_home: String,
    source_config: String,
    codex_attached: bool,
}

#[derive(Default)]
struct Model {
    lifecycle: Lifecycle,
    message: String,
    log_path: PathBuf,
    control: Option<Sender<backend::Control>>,
    backend_pid: Option<u32>,
    dashboard_url: Option<String>,
    dashboard_label: Option<String>,
    page_loaded: bool,
    wants_window: bool,
    activation_count: u32,
    exit_code: i32,
    codex_routing: String,
    routing_busy: bool,
    // Only an explicit restart carries the previous route across native cleanup.
    restart_resume_codex: bool,
    codex_attached: bool,
}

struct DesktopState {
    repo: PathBuf,
    session: PathBuf,
    profile: profile::Profile,
    model: Mutex<Model>,
}
struct TrayItems {
    status: MenuItem<tauri::Wry>,
    start: MenuItem<tauri::Wry>,
    stop: MenuItem<tauri::Wry>,
    restart: MenuItem<tauri::Wry>,
    routing_status: MenuItem<tauri::Wry>,
    restore: MenuItem<tauri::Wry>,
    restore_back: MenuItem<tauri::Wry>,
}

fn status(app: &tauri::AppHandle) -> Status {
    let state = app.state::<DesktopState>();
    let model = state.model.lock().unwrap();
    Status {
        phase: model.lifecycle.phase,
        message: model.message.clone(),
        log_path: model.log_path.display().to_string(),
        page_loaded: model.page_loaded,
        generation: model.lifecycle.generation,
        backend_pid: model.backend_pid,
        dashboard_url: model.dashboard_url.clone(),
        can_start: model.lifecycle.can_start(),
        can_stop: model.lifecycle.can_stop(),
        can_restart: model.lifecycle.can_restart() && !model.routing_busy,
        activation_count: model.activation_count,
        codex_routing: model.codex_routing.clone(),
        routing_busy: model.routing_busy,
        can_route: model.lifecycle.can_restart() && !model.routing_busy,
        persistent: state.profile.persistent,
        data_dir: state.profile.root.display().to_string(),
        codex_home: state.profile.codex_home.display().to_string(),
        source_config: state.profile.source_config.display().to_string(),
        codex_attached: model.codex_attached,
    }
}

// Lifecycle mutations and window/menu operations run on Tauri's event loop.
// Never hold a model lock while calling a native UI API.
fn refresh(app: &tauri::AppHandle) {
    let snapshot = status(app);
    let state = app.state::<DesktopState>();
    if let Ok(json) = serde_json::to_vec_pretty(&snapshot) {
        let _ = fs::write(state.session.join("desktop-status.json"), json);
    }
    let label = match snapshot.phase {
        Phase::Starting => "代理正在启动",
        Phase::Ready => "代理已就绪，界面加载中",
        Phase::Loaded => "代理正在运行",
        Phase::Stopping => "代理正在停止",
        Phase::Stopped => "代理已停止",
        Phase::Error => "代理遇到问题",
        Phase::Exiting => "应用正在退出",
    };
    if let Some(items) = app.try_state::<TrayItems>() {
        let _ = items.status.set_text(label);
        let _ = items.start.set_enabled(snapshot.can_start);
        let _ = items.stop.set_enabled(snapshot.can_stop);
        let _ = items.restart.set_enabled(snapshot.can_restart);
        let routing = if snapshot.persistent && !snapshot.codex_attached {
            "Codex：尚未接入桌面代理"
        } else if snapshot.routing_busy {
            "Codex：正在切换…"
        } else {
            match snapshot.codex_routing.as_str() {
                "native" => "Codex：原生模式",
                "opencodex-local" => "Codex：通过 OpenCodex 代理",
                _ => "Codex：路由状态未确认",
            }
        };
        let _ = items.routing_status.set_text(routing);
        let _ = items.restore.set_enabled(snapshot.can_route);
        let _ = items.restore_back.set_enabled(snapshot.can_route);
    }
    if let Some(tray) = app.tray_by_id("desktop") {
        let _ = tray.set_tooltip(Some(format!("OpenCodex Desktop · {label}")));
    }
}

fn show_window(app: &tauri::AppHandle, controls: bool) {
    let label = {
        let state = app.state::<DesktopState>();
        let mut model = state.model.lock().unwrap();
        model.wants_window = true;
        if !controls && model.lifecycle.phase == Phase::Loaded {
            model
                .dashboard_label
                .clone()
                .unwrap_or_else(|| "launcher".into())
        } else {
            "launcher".into()
        }
    };
    for (name, window) in app.webview_windows() {
        if name == label {
            let _ = window.unminimize();
            let _ = window.show();
            let _ = window.set_focus();
        } else {
            let _ = window.hide();
        }
    }
}

fn hide_windows(app: &tauri::AppHandle) {
    app.state::<DesktopState>()
        .model
        .lock()
        .unwrap()
        .wants_window = false;
    for window in app.webview_windows().values() {
        let _ = window.hide();
    }
}

fn request_stop(app: &tauri::AppHandle, intent: Intent) {
    let active = {
        let state = app.state::<DesktopState>();
        let mut model = state.model.lock().unwrap();
        if model.lifecycle.phase == Phase::Exiting {
            return;
        }
        model.restart_resume_codex =
            intent == Intent::Restart && model.codex_routing == "opencodex-local";
        model.lifecycle.stop(intent);
        let message = match intent {
            Intent::Restart => Some("正在排空请求，旧后端退出后将重新启动…"),
            Intent::Exit => Some("正在停止代理并恢复配置，完成后退出应用…"),
            Intent::Stop => Some("正在排空请求并停止代理，桌面应用将继续驻留…"),
            Intent::Failure => None,
        };
        if let Some(message) = message {
            model.message = message.into();
        }
        if let Some(control) = &model.control {
            let _ = control.send(backend::Control::Stop {
                disconnect: intent == Intent::Stop,
            });
        }
        model.lifecycle.active
    };
    refresh(app);
    if intent != Intent::Exit {
        show_window(app, true);
    }
    if !active && intent == Intent::Exit {
        let code = app.state::<DesktopState>().model.lock().unwrap().exit_code;
        app.exit(code);
    }
}

fn fail(app: &tauri::AppHandle, message: String) {
    app.state::<DesktopState>().model.lock().unwrap().message = message;
    request_stop(app, Intent::Failure);
}

fn start_backend(app: &tauri::AppHandle) {
    let state = app.state::<DesktopState>();
    let (generation, old_window, log_path, resume_codex) = {
        let mut model = state.model.lock().unwrap();
        let Some(generation) = model.lifecycle.start() else {
            return;
        };
        model.message = "正在启动项目内后端并校验进程身份…".into();
        model.backend_pid = None;
        model.page_loaded = false;
        model.dashboard_url = None;
        model.codex_routing = "unknown".into();
        model.routing_busy = false;
        model.log_path = state.session.join(format!("backend-{generation}.log"));
        (
            generation,
            model.dashboard_label.take(),
            model.log_path.clone(),
            std::mem::take(&mut model.restart_resume_codex),
        )
    };
    if let Some(window) = old_window.and_then(|label| app.get_webview_window(&label)) {
        let _ = window.destroy();
    }
    refresh(app);
    show_window(app, true);
    let event_app = app.clone();
    let control = backend::spawn(
        state.repo.clone(),
        state.profile.clone(),
        log_path,
        resume_codex,
        move |event| {
            let app = event_app.clone();
            let _ = event_app.run_on_main_thread(move || backend_event(&app, generation, event));
        },
    );
    state.model.lock().unwrap().control = Some(control);
}

fn backend_event(app: &tauri::AppHandle, generation: u64, event: backend::Event) {
    let state = app.state::<DesktopState>();
    {
        let model = state.model.lock().unwrap();
        if model.lifecycle.generation != generation || !model.lifecycle.active {
            return;
        }
    }
    match event {
        backend::Event::Started(pid) => {
            state.model.lock().unwrap().backend_pid = Some(pid);
        }
        backend::Event::Profile(attached) => {
            state.model.lock().unwrap().codex_attached = attached;
        }
        backend::Event::Reconfigure(message) => {
            state.model.lock().unwrap().routing_busy = false;
            request_stop(app, Intent::Restart);
            state.model.lock().unwrap().message = message;
        }
        backend::Event::Ready(raw) => {
            let Some(url) = backend_url(&raw) else {
                fail(app, "后端返回了无效的本地地址，请查看日志。".into());
                return;
            };
            {
                let mut model = state.model.lock().unwrap();
                if !model.lifecycle.ready(generation) {
                    return;
                }
                model.dashboard_url = Some(raw);
                model.message = "代理已就绪，正在加载管理界面…".into();
            }
            if let Err(error) = open_dashboard(app, url, generation) {
                fail(app, format!("无法创建管理窗口：{error}"));
            }
        }
        backend::Event::Error(message) => {
            if state.model.lock().unwrap().lifecycle.can_stop() {
                fail(app, message);
            }
        }
        backend::Event::Routing {
            routing,
            success,
            message,
        } => {
            {
                let mut model = state.model.lock().unwrap();
                model.codex_routing = routing;
                // A startup status event must not acknowledge a later user operation.
                if success.is_some() {
                    model.routing_busy = false;
                }
                if let Some(message) = message {
                    model.message = message;
                }
            }
            if success == Some(false) {
                show_window(app, true);
            }
        }
        backend::Event::Finished { success, message } => {
            let outcome = {
                let mut model = state.model.lock().unwrap();
                let earlier_error =
                    (model.lifecycle.phase == Phase::Error).then(|| model.message.clone());
                let outcome = model.lifecycle.finished(generation, success);
                if outcome != Completion::Restart {
                    model.restart_resume_codex = false;
                }
                model.control = None;
                model.backend_pid = None;
                model.routing_busy = false;
                model.codex_routing = if success { "native" } else { "unknown" }.into();
                model.message = if outcome == Completion::Error {
                    format!(
                        "{} {message} 请检查日志后手动启动重试。",
                        earlier_error.unwrap_or_default()
                    )
                    .trim()
                    .into()
                } else {
                    message
                };
                if outcome == Completion::Exit && !success {
                    model.exit_code = 1;
                }
                outcome
            };
            refresh(app);
            match outcome {
                Completion::Restart => start_backend(app),
                Completion::Exit => {
                    let code = state.model.lock().unwrap().exit_code;
                    app.exit(code);
                }
                Completion::Stopped | Completion::Error => show_window(app, true),
                Completion::Stale => {}
            }
        }
    }
    refresh(app);
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

fn open_dashboard(app: &tauri::AppHandle, url: tauri::Url, generation: u64) -> tauri::Result<()> {
    let origin = url.origin();
    let page_origin = origin.clone();
    let navigation_app = app.clone();
    let external_app = app.clone();
    let page_app = app.clone();
    let state = app.state::<DesktopState>();
    let label = format!("dashboard-{generation}");
    state.model.lock().unwrap().dashboard_label = Some(label.clone());
    WebviewWindowBuilder::new(app, label, WebviewUrl::External(url))
        .title("OpenCodex Desktop · 开发预览（关闭窗口后驻留托盘）")
        .inner_size(1320.0, 860.0)
        .min_inner_size(960.0, 640.0)
        .visible(false)
        .data_directory(state.profile.root.join("webview"))
        .on_navigation(move |target| {
            if target.origin() == origin {
                return true;
            }
            if matches!(target.scheme(), "http" | "https") {
                let _ = navigation_app
                    .opener()
                    .open_url(target.as_str(), None::<&str>);
            }
            false
        })
        .on_new_window(move |target, _| {
            if matches!(target.scheme(), "http" | "https") {
                let _ = external_app
                    .opener()
                    .open_url(target.as_str(), None::<&str>);
            }
            tauri::webview::NewWindowResponse::Deny
        })
        .on_page_load(move |_, payload| {
            if payload.event() != tauri::webview::PageLoadEvent::Finished
                || payload.url().origin() != page_origin
            {
                return;
            }
            let state = page_app.state::<DesktopState>();
            let show = {
                let mut model = state.model.lock().unwrap();
                if !model.lifecycle.loaded(generation) {
                    return;
                }
                model.page_loaded = true;
                model.message = "代理正在运行。关闭窗口后继续驻留；可从系统托盘打开或退出。".into();
                model.wants_window
            };
            refresh(&page_app);
            if show {
                show_window(&page_app, false);
            }
        })
        .build()?;
    let timeout_app = app.clone();
    thread::spawn(move || {
        thread::sleep(Duration::from_secs(45));
        let app = timeout_app.clone();
        let _ = timeout_app.run_on_main_thread(move || {
            let snapshot = status(&app);
            if snapshot.generation == generation && snapshot.phase == Phase::Ready {
                fail(&app, "管理界面加载超时，可查看日志后重试。".into());
            }
        });
    });
    Ok(())
}

fn action(app: &tauri::AppHandle, name: &str) {
    let snapshot = status(app);
    match name {
        "open" => show_window(app, false),
        "controls" => show_window(app, true),
        "hide" => hide_windows(app),
        "start" if snapshot.can_start => start_backend(app),
        "stop" if snapshot.can_stop || snapshot.phase == Phase::Stopping => {
            request_stop(app, Intent::Stop)
        }
        "restart" if snapshot.can_restart => request_stop(app, Intent::Restart),
        "restore-back" if snapshot.persistent && !snapshot.codex_attached => {
            app.state::<DesktopState>().model.lock().unwrap().message =
                "请在桌面控制页确认 Codex 目录并启用连接。".into();
            show_window(app, true);
            refresh(app);
        }
        "restore" | "restore-back" | "connect-codex" if snapshot.can_route => {
            let state = app.state::<DesktopState>();
            {
                let mut model = state.model.lock().unwrap();
                let command = if name == "restore" {
                    backend::Control::Restore
                } else {
                    backend::Control::RestoreBack
                };
                if model
                    .control
                    .as_ref()
                    .is_some_and(|control| control.send(command).is_ok())
                {
                    model.routing_busy = true;
                    model.message = if name == "restore" {
                        "正在恢复原生 Codex，代理将保持运行…"
                    } else {
                        "正在将 Codex 接回当前代理…"
                    }
                    .into();
                } else {
                    model.message = "无法向当前后端发送 Codex 切换请求。".into();
                }
            }
            refresh(app);
        }
        "import-existing" if snapshot.can_route => {
            send_import(app, None);
        }
        "data" => {
            let path = app
                .state::<DesktopState>()
                .profile
                .root
                .display()
                .to_string();
            let _ = app.opener().open_path(path, None::<&str>);
        }
        "quit" => request_stop(app, Intent::Exit),
        "logs" => {
            let path = app.state::<DesktopState>().session.display().to_string();
            if let Err(error) = app.opener().open_path(path, None::<&str>) {
                app.state::<DesktopState>().model.lock().unwrap().message =
                    format!("无法打开日志目录：{error}");
                refresh(app);
                show_window(app, true);
            }
        }
        _ => {}
    }
}

fn send_import(app: &tauri::AppHandle, config: Option<String>) {
    let state = app.state::<DesktopState>();
    if !status(app).can_route {
        return;
    }
    {
        let mut model = state.model.lock().unwrap();
        let command = config
            .map(backend::Control::Import)
            .unwrap_or(backend::Control::ImportExisting);
        if model
            .control
            .as_ref()
            .is_some_and(|control| control.send(command).is_ok())
        {
            model.routing_busy = true;
            model.message = "正在校验并导入配置…".into();
        }
    }
    refresh(app);
}

#[tauri::command]
fn desktop_import_config(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    config: String,
) -> Result<(), String> {
    if window.label() != "launcher" {
        return Err("Only the local launcher may import configuration".into());
    }
    if config.len() > 1024 * 1024 {
        return Err("配置文件不能超过 1 MB".into());
    }
    let target = app.clone();
    app.run_on_main_thread(move || send_import(&target, Some(config)))
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn desktop_status(window: tauri::WebviewWindow, app: tauri::AppHandle) -> Result<Status, String> {
    if window.label() != "launcher" {
        return Err("Only the local launcher may access desktop commands".into());
    }
    Ok(status(&app))
}

#[tauri::command]
fn desktop_action(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    name: String,
) -> Result<(), String> {
    if window.label() != "launcher" {
        return Err("Only the local launcher may access desktop commands".into());
    }
    if ![
        "open",
        "hide",
        "start",
        "stop",
        "restart",
        "restore",
        "restore-back",
        "connect-codex",
        "import-existing",
        "data",
        "logs",
        "quit",
    ]
    .contains(&name.as_str())
    {
        return Err("Unknown desktop action".into());
    }
    let target = app.clone();
    app.run_on_main_thread(move || action(&target, &name))
        .map_err(|e| e.to_string())
}

fn install_tray(app: &tauri::AppHandle) -> tauri::Result<()> {
    let item = |id, text, enabled| MenuItem::with_id(app, id, text, enabled, None::<&str>);
    let open = item("open", "打开主窗口", true)?;
    let controls = item("controls", "桌面状态与控制", true)?;
    let status = item("status", "代理正在启动", false)?;
    let start = item("start", "启动代理", false)?;
    let stop = item("stop", "停止代理并恢复原生 Codex", true)?;
    let restart = item("restart", "重启代理", false)?;
    let routing_status = item("routing-status", "Codex：路由状态未确认", false)?;
    let restore = item("restore", "恢复原生 Codex（代理继续运行）", false)?;
    let restore_back = item("restore-back", "将 Codex 重新接回当前代理", false)?;
    let logs = item("logs", "打开日志目录", true)?;
    let quit = item("quit", "退出应用并恢复原生 Codex", true)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let routing_separator = PredefinedMenuItem::separator(app)?;
    let bottom = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(
        app,
        &[
            &open,
            &controls,
            &separator,
            &status,
            &start,
            &restart,
            &routing_separator,
            &routing_status,
            &stop,
            &restore,
            &restore_back,
            &bottom,
            &logs,
            &quit,
        ],
    )?;
    TrayIconBuilder::with_id("desktop")
        .icon(app.default_window_icon().expect("application icon").clone())
        .tooltip("OpenCodex Desktop · 开发预览")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| action(app, event.id.as_ref()))
        .on_tray_icon_event(|tray, event| {
            if matches!(
                event,
                TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                }
            ) {
                show_window(tray.app_handle(), false);
            }
        })
        .build(app)?;
    app.manage(TrayItems {
        status,
        start,
        stop,
        restart,
        routing_status,
        restore,
        restore_back,
    });
    Ok(())
}

fn main() {
    tauri::Builder::default()
        // Register before any plugin or setup code that could start a backend.
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            let target = app.clone();
            let _ = app.run_on_main_thread(move || {
                if let Some(state) = target.try_state::<DesktopState>() {
                    state.model.lock().unwrap().activation_count += 1;
                    show_window(&target, false);
                    refresh(&target);
                }
            });
        }))
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            desktop_status,
            desktop_action,
            desktop_import_config
        ])
        .setup(|app| {
            let repo = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("../..")
                .canonicalize()?;
            let profile = profile::Profile::create(app.handle(), &repo)?;
            let session = profile.session.clone();
            app.manage(DesktopState {
                repo,
                session,
                profile,
                model: Mutex::new(Model {
                    wants_window: true,
                    ..Model::default()
                }),
            });
            WebviewWindowBuilder::new(app, "launcher", WebviewUrl::App("index.html".into()))
                .title("OpenCodex Desktop · 状态与控制")
                .inner_size(740.0, 780.0)
                .min_inner_size(640.0, 640.0)
                .on_navigation(|url| {
                    url.scheme() == "tauri" || url.host_str() == Some("tauri.localhost")
                })
                .build()?;
            install_tray(app.handle())?;
            start_backend(app.handle());
            #[cfg(debug_assertions)]
            smoke::install(app.handle());
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                hide_windows(window.app_handle());
            }
        })
        .build(tauri::generate_context!())
        .expect("Cannot initialize OpenCodex Desktop")
        .run(|app, event| {
            if let tauri::RunEvent::ExitRequested { api, .. } = event {
                let state = app.state::<DesktopState>();
                let can_exit = {
                    let model = state.model.lock().unwrap();
                    model.lifecycle.phase == Phase::Exiting && !model.lifecycle.active
                };
                if !can_exit {
                    api.prevent_exit();
                    request_stop(app, Intent::Exit);
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
