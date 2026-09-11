//! Opt-in debug checks exercise real WebView2 windows and the owned backend.
//! No test-control endpoint or remote-page command is exposed.
use super::*;
use std::{
    io::{Read, Write},
    net::TcpStream,
    process::Command,
    sync::mpsc,
    time::Instant,
};

fn on_ui<T: Send + 'static>(
    app: &tauri::AppHandle,
    callback: impl FnOnce(&tauri::AppHandle) -> T + Send + 'static,
) -> Result<T, String> {
    let (tx, rx) = mpsc::channel();
    let target = app.clone();
    app.run_on_main_thread(move || {
        let _ = tx.send(callback(&target));
    })
    .map_err(|e| e.to_string())?;
    rx.recv_timeout(Duration::from_secs(10))
        .map_err(|e| e.to_string())
}

fn wait_for(app: &tauri::AppHandle, predicate: impl Fn(&Status) -> bool) -> Result<Status, String> {
    let deadline = Instant::now() + Duration::from_secs(100);
    loop {
        let snapshot = status(app);
        if predicate(&snapshot) {
            return Ok(snapshot);
        }
        if snapshot.phase == Phase::Error && snapshot.can_start {
            return Err(snapshot.message);
        }
        if Instant::now() >= deadline {
            return Err(format!(
                "Timed out: {:?}: {}",
                snapshot.phase, snapshot.message
            ));
        }
        thread::sleep(Duration::from_millis(100));
    }
}

fn gui_available(url: &str) -> Result<(), String> {
    let url = backend_url(url).ok_or("Invalid owned URL")?;
    let mut stream = TcpStream::connect_timeout(
        &format!("127.0.0.1:{}", url.port().unwrap())
            .parse()
            .unwrap(),
        Duration::from_secs(3),
    )
    .map_err(|e| e.to_string())?;
    stream
        .set_read_timeout(Some(Duration::from_secs(3)))
        .map_err(|e| e.to_string())?;
    write!(
        stream,
        "GET / HTTP/1.1\r\nHost: 127.0.0.1:{}\r\nConnection: close\r\n\r\n",
        url.port().unwrap()
    )
    .map_err(|e| e.to_string())?;
    let mut response = [0; 128];
    let read = stream.read(&mut response).map_err(|e| e.to_string())?;
    if !String::from_utf8_lossy(&response[..read]).starts_with("HTTP/1.1 200") {
        return Err("GUI unavailable while hidden".into());
    }
    Ok(())
}

fn lifecycle_check(app: &tauri::AppHandle, steps: &mut Vec<&str>) -> Result<(), String> {
    let first = wait_for(app, |s| s.phase == Phase::Loaded)?;
    if !on_ui(app, |a| a.tray_by_id("desktop").is_some())? {
        return Err("Tray was not created".into());
    }
    steps.push("real_webview_and_tray_created");

    on_ui(app, |a| {
        let label = a
            .state::<DesktopState>()
            .model
            .lock()
            .unwrap()
            .dashboard_label
            .clone()
            .unwrap();
        a.get_webview_window(&label)
            .unwrap()
            .eval("document.querySelector('.main .notice button')?.click();")
    })?
    .map_err(|e| e.to_string())?;
    let until = Instant::now() + Duration::from_secs(10);
    while !on_ui(app, |a| {
        a.get_webview_window("launcher")
            .unwrap()
            .is_visible()
            .unwrap_or(false)
    })? {
        if Instant::now() > until {
            return Err("Dashboard control link did not open the launcher".into());
        }
        thread::sleep(Duration::from_millis(100));
    }
    if status(app).backend_pid != first.backend_pid {
        return Err("Opening desktop controls restarted the backend".into());
    }
    steps.push("dashboard_control_link_opens_local_controls_without_host_mutation");
    on_ui(app, |a| show_window(a, false))?;
    on_ui(app, |a| {
        let label = a.state::<DesktopState>().model.lock().unwrap().dashboard_label.clone().unwrap();
        a.get_webview_window(&label).unwrap().eval("const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['desktop-download-ok'], {type: 'text/plain'})); a.download = 'desktop-smoke.txt'; document.body.append(a); a.click(); a.remove();")
    })?.map_err(|e| e.to_string())?;
    let downloads = crate::downloads::directory(app)?;
    let until = Instant::now() + Duration::from_secs(15);
    loop {
        let downloaded = fs::read_dir(&downloads)
            .map_err(|e| e.to_string())?
            .flatten()
            .any(|entry| {
                fs::read_to_string(entry.path()).ok().as_deref() == Some("desktop-download-ok")
            });
        if downloaded {
            break;
        }
        if Instant::now() > until {
            return Err("WebView2 blob export did not reach the isolated downloads folder".into());
        }
        thread::sleep(Duration::from_millis(100));
    }
    steps.push("webview_blob_export_reaches_isolated_downloads");

    on_ui(app, |a| {
        let label = a
            .state::<DesktopState>()
            .model
            .lock()
            .unwrap()
            .dashboard_label
            .clone()
            .unwrap();
        a.get_webview_window(&label)
            .unwrap()
            .close()
            .map_err(|e| e.to_string())
    })??;
    thread::sleep(Duration::from_millis(300));
    let hidden = on_ui(app, |a| {
        a.webview_windows()
            .values()
            .all(|w| !w.is_visible().unwrap_or(true))
    })?;
    if !hidden || status(app).backend_pid != first.backend_pid {
        return Err("Close did not hide with the same backend".into());
    }
    gui_available(first.dashboard_url.as_ref().unwrap())?;
    steps.push("close_hides_and_backend_stays_available");

    let mut command = Command::new(std::env::current_exe().map_err(|e| e.to_string())?);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    let mut duplicate = command.spawn().map_err(|e| e.to_string())?;
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        if let Some(code) = duplicate.try_wait().map_err(|e| e.to_string())? {
            if !code.success() {
                return Err("Second launch failed".into());
            }
            break;
        }
        if Instant::now() > deadline {
            let _ = duplicate.kill();
            let _ = duplicate.wait();
            return Err("Second launch did not exit".into());
        }
        thread::sleep(Duration::from_millis(100));
    }
    let activated = wait_for(app, |s| s.activation_count > first.activation_count)?;
    if activated.backend_pid != first.backend_pid || activated.generation != first.generation {
        return Err("Second launch started another backend".into());
    }
    let visible = on_ui(app, |a| {
        let label = a
            .state::<DesktopState>()
            .model
            .lock()
            .unwrap()
            .dashboard_label
            .clone()
            .unwrap();
        a.get_webview_window(&label)
            .unwrap()
            .is_visible()
            .unwrap_or(false)
    })?;
    if !visible {
        return Err("Second launch did not show the original window".into());
    }
    steps.push("second_launch_focuses_existing_instance");

    let session = app.state::<DesktopState>().session.clone();
    let codex_path = session.join(".codex/config.toml");
    let native_config = "# Desktop routing smoke\nmodel = \"gpt-5.4\"\n";
    fs::write(&codex_path, native_config).map_err(|e| e.to_string())?;
    on_ui(app, |a| action(a, "restore-back"))?;
    let routed = wait_for(app, |s| !s.routing_busy)?;
    if routed.codex_routing != "opencodex-local" || routed.backend_pid != first.backend_pid {
        return Err(format!(
            "restore back did not switch the existing backend: {}",
            routed.message
        ));
    }
    let routed_config = fs::read_to_string(&codex_path).map_err(|e| e.to_string())?;
    if !routed_config.contains(first.dashboard_url.as_ref().unwrap().trim_end_matches('/')) {
        return Err("Codex was not pointed at the owned runtime port".into());
    }
    gui_available(first.dashboard_url.as_ref().unwrap())?;
    on_ui(app, |a| action(a, "restore"))?;
    let restored = wait_for(app, |s| !s.routing_busy)?;
    if restored.codex_routing != "native" || restored.backend_pid != first.backend_pid {
        return Err(format!(
            "restore did not preserve the running backend: {}",
            restored.message
        ));
    }
    if fs::read_to_string(&codex_path).map_err(|e| e.to_string())? != native_config {
        return Err("restore did not recover the native config contents".into());
    }
    gui_available(first.dashboard_url.as_ref().unwrap())?;
    steps.push("native_restore_back_and_restore_round_trip_without_stopping_proxy");
    on_ui(app, |a| action(a, "restore-back"))?;
    let routed_again = wait_for(app, |s| !s.routing_busy)?;
    if routed_again.codex_routing != "opencodex-local" {
        return Err(routed_again.message);
    }

    on_ui(app, |a| action(a, "restart"))?;
    let second = wait_for(app, |s| {
        s.phase == Phase::Loaded && s.generation == first.generation + 1
    })?;
    if second.backend_pid == first.backend_pid {
        return Err("Restart did not replace the backend".into());
    }
    wait_for(app, |s| s.codex_routing == "opencodex-local")?;
    steps.push("restart_preserves_the_explicit_proxy_routing_choice");
    steps.push("restart_reaps_old_backend_and_loads_new_window");

    on_ui(app, |a| action(a, "stop"))?;
    let stopped = wait_for(app, |s| s.phase == Phase::Stopped)?;
    if stopped.backend_pid.is_some() || !stopped.can_start {
        return Err("Stop left backend active".into());
    }
    if session.join(".opencodex/runtime-port.json").exists() {
        return Err("Stop did not clean runtime record".into());
    }
    if fs::read_to_string(&codex_path).map_err(|e| e.to_string())? != native_config {
        return Err("stop did not restore native Codex config".into());
    }
    steps.push("stop_restores_native_codex_and_keeps_the_desktop_app");
    // A user setting written while stopped must survive a subsequent start.
    let config_path = session.join(".opencodex/config.json");
    let mut config: serde_json::Value =
        serde_json::from_slice(&fs::read(&config_path).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
    config["shutdownTimeoutMs"] = 4321.into();
    fs::write(&config_path, serde_json::to_vec_pretty(&config).unwrap())
        .map_err(|e| e.to_string())?;
    on_ui(app, |a| action(a, "start"))?;
    let third = wait_for(app, |s| {
        s.phase == Phase::Loaded && s.generation == second.generation + 1
    })?;
    let config: serde_json::Value =
        serde_json::from_slice(&fs::read(&config_path).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
    if config["shutdownTimeoutMs"] != 4321 {
        return Err("Restart lost session settings".into());
    }
    steps.push("stop_start_preserves_session_settings_and_cleans_records");

    {
        let state = app.state::<DesktopState>();
        let model = state.model.lock().unwrap();
        model
            .control
            .as_ref()
            .unwrap()
            .send(backend::Control::CrashForSmoke)
            .map_err(|e| e.to_string())?;
    }
    wait_for(app, |s| s.phase == Phase::Error && s.can_start)?;
    thread::sleep(Duration::from_secs(1));
    if status(app).generation != third.generation {
        return Err("Crash caused an automatic restart loop".into());
    }
    let error_visible = on_ui(app, |a| {
        a.get_webview_window("launcher")
            .unwrap()
            .is_visible()
            .unwrap_or(false)
    })?;
    if !error_visible {
        return Err("Crash did not expose the recovery window".into());
    }
    on_ui(app, |a| action(a, "start"))?;
    wait_for(app, |s| {
        s.phase == Phase::Loaded && s.generation == third.generation + 1
    })?;
    steps.push("crash_exposes_error_and_manual_retry_recovers");

    // Both actions enter the same queue as tray clicks. Shutdown must join the
    // admitted CLI write before restoring native config, including pipe batching.
    let admitted = on_ui(app, |a| {
        action(a, "restore-back");
        let admitted = status(a).routing_busy;
        action(a, "stop");
        admitted
    })?;
    if !admitted {
        return Err("routing operation was not admitted before stop".into());
    }
    wait_for(app, |s| s.phase == Phase::Stopped)?;
    if fs::read_to_string(&codex_path).map_err(|e| e.to_string())? != native_config
        || session.join(".opencodex/runtime-port.json").exists()
    {
        return Err("stop raced the routing write or left a runtime record".into());
    }
    steps.push("stop_during_routing_restores_native_config_after_the_pending_write");
    on_ui(app, |a| action(a, "start"))?;
    wait_for(app, |s| s.phase == Phase::Loaded)?;
    Ok(())
}

fn persistent_check(app: &tauri::AppHandle, steps: &mut Vec<&str>) -> Result<(), String> {
    let first = wait_for(app, |s| s.phase == Phase::Loaded)?;
    if !first.persistent {
        return Err("persistent window started in preview mode".into());
    }
    if !std::env::args().any(|arg| arg == "--smoke-reopen") {
        if first.codex_attached {
            return Err("first launch connected without an explicit action".into());
        }
        on_ui(app, |a| action(a, "restore-back"))?;
        if status(app).routing_busy {
            return Err("tray action bypassed first-connection confirmation".into());
        }
        let visible = on_ui(app, |a| {
            a.get_webview_window("launcher")
                .unwrap()
                .is_visible()
                .unwrap_or(false)
        })?;
        if !visible {
            return Err("tray action did not show connection controls".into());
        }
        on_ui(app, |a| action(a, "connect-codex"))?;
        wait_for(app, |s| {
            s.phase == Phase::Loaded && s.generation > first.generation && s.codex_attached
        })?;
        steps.push(
            "first_connection_requires_local_controls_then_restarts_into_the_selected_client",
        );
    } else {
        if !first.codex_attached {
            return Err("reopen lost the saved connection choice".into());
        }
        steps.push("full_application_reopen_remembers_connection_and_storage");
    }
    let running = wait_for(app, |s| s.codex_routing == "opencodex-local")?;
    gui_available(running.dashboard_url.as_ref().unwrap())?;
    let state = app.state::<DesktopState>();
    let config = fs::read_to_string(state.profile.codex_home.join("config.toml"))
        .map_err(|e| e.to_string())?;
    if !config.contains(
        running
            .dashboard_url
            .as_ref()
            .unwrap()
            .trim_end_matches('/'),
    ) {
        return Err("client is not using this window's backend".into());
    }
    steps.push("persistent_window_loads_the_owned_backend_and_client_route");
    Ok(())
}

pub fn install(app: &tauri::AppHandle) {
    let full = std::env::args().any(|arg| arg == "--smoke-lifecycle");
    let startup_stop = std::env::args().any(|arg| arg == "--smoke-startup-stop");
    let persistent = std::env::args().any(|arg| arg == "--smoke-persistent");
    if !full && !startup_stop && !persistent && !std::env::args().any(|arg| arg == "--smoke-test") {
        return;
    }
    let app = app.clone();
    thread::spawn(move || {
        let mut steps = Vec::new();
        let result = if persistent {
            persistent_check(&app, &mut steps)
        } else if full {
            lifecycle_check(&app, &mut steps)
        } else if startup_stop {
            on_ui(&app, |a| action(a, "stop"))
                .and_then(|_| wait_for(&app, |s| s.phase == Phase::Stopped))
                .map(|_| {
                    steps.push("stop_during_startup_cleans_owned_backend");
                })
        } else {
            wait_for(&app, |s| s.phase == Phase::Loaded).map(|_| {
                steps.push("real_webview_loaded");
            })
        };
        let session = app.state::<DesktopState>().session.clone();
        let report =
            serde_json::json!({ "ok": result.is_ok(), "steps": steps, "error": result.err() });
        let _ = fs::write(
            session.join("smoke-result.json"),
            serde_json::to_vec_pretty(&report).unwrap(),
        );
        if report["ok"] != true {
            app.state::<DesktopState>().model.lock().unwrap().exit_code = 1;
        }
        let _ = on_ui(&app, move |a| {
            // Exercise quit winning over an in-flight restart. Final process exit
            // and config fingerprints are checked by scripts/native-smoke.ts.
            if full && report["ok"] == true {
                action(a, "restart");
            }
            action(a, "quit");
        });
    });
}
