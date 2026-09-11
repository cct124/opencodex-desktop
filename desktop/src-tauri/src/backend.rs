use serde::Deserialize;
use std::{
    fs::OpenOptions,
    io::{BufRead, BufReader, Write},
    path::PathBuf,
    process::{ChildStdin, Command, Stdio},
    sync::mpsc::{self, Sender, TryRecvError},
    thread,
    time::{Duration, Instant},
};

pub enum Control {
    Stop {
        disconnect: bool,
    },
    Restore,
    RestoreBack,
    Import(String),
    ImportExisting,
    #[cfg(debug_assertions)]
    CrashForSmoke,
}

pub enum Event {
    Started(u32),
    Ready(String),
    Profile(bool),
    Reconfigure(String),
    Routing {
        routing: String,
        success: Option<bool>,
        message: Option<String>,
    },
    Error(String),
    Finished {
        success: bool,
        message: String,
    },
}

#[derive(Deserialize)]
struct WireEvent {
    #[serde(rename = "type")]
    kind: String,
    pid: u32,
    url: Option<String>,
    message: Option<String>,
    routing: Option<String>,
    success: Option<bool>,
    attached: Option<bool>,
}

fn shutdown(input: &mut Option<ChildStdin>, requested: &mut Option<Instant>, disconnect: bool) {
    if requested.is_some() {
        return;
    }
    *requested = Some(Instant::now());
    if let Some(mut pipe) = input.take() {
        let _ = pipe.write_all(if disconnect {
            b"shutdown-disconnect\n"
        } else {
            b"shutdown\n"
        });
        let _ = pipe.flush();
        // Closing this pipe also triggers cleanup if the desktop process disappears.
    }
}

/// Each worker owns exactly one Child. A later restart cannot replace the handle
/// under an old monitor, and all events carry a generation at the UI boundary.
pub fn spawn(
    repo: PathBuf,
    profile: crate::profile::Profile,
    log_path: PathBuf,
    resume_codex: bool,
    emit: impl Fn(Event) + Send + 'static,
) -> Sender<Control> {
    let (tx, rx) = mpsc::channel();
    thread::spawn(move || {
        let run = || -> Result<(), Box<dyn std::error::Error>> {
            let bun = repo.join("node_modules/bun/bin/bun.exe");
            if !bun.is_file() {
                return Err("缺少项目内 Bun，请先完成依赖安装。".into());
            }
            if !repo.join("gui/dist/index.html").is_file() {
                return Err("缺少管理界面，请先运行上游 build:gui。".into());
            }
            let log = OpenOptions::new()
                .create(true)
                .append(true)
                .open(log_path)?;
            let mut command = Command::new(bun);
            command
                .arg(repo.join("desktop/runtime/entry.ts"))
                .arg(&profile.session)
                .current_dir(repo)
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .stderr(Stdio::from(log.try_clone()?));
            if resume_codex {
                command.arg("--resume-codex");
            }
            if profile.persistent {
                command
                    .arg("--persistent")
                    .arg("--data-root")
                    .arg(&profile.root)
                    .arg("--codex-home")
                    .arg(&profile.codex_home)
                    .arg("--source-config")
                    .arg(&profile.source_config);
            }
            #[cfg(windows)]
            {
                use std::os::windows::process::CommandExt;
                command.creation_flags(0x08000000); // CREATE_NO_WINDOW
            }
            let mut child = command.spawn()?;
            let pid = child.id();
            let mut input = child.stdin.take();
            let output = child.stdout.take().expect("piped stdout");
            emit(Event::Started(pid));
            let (events_tx, events_rx) = mpsc::channel();
            thread::spawn(move || {
                let mut log = log;
                for line in BufReader::new(output).lines() {
                    let Ok(line) = line else { break };
                    let _ = writeln!(log, "{line}");
                    if let Some(raw) = line.strip_prefix("OCX_DESKTOP_EVENT ") {
                        if let Ok(event) = serde_json::from_str::<WireEvent>(raw) {
                            if event.pid == pid {
                                let _ = events_tx.send(event);
                            }
                        }
                    }
                }
            });
            let started = Instant::now();
            let mut ready = false;
            let mut requested = None;
            let mut forced = false;
            loop {
                match rx.try_recv() {
                    Ok(Control::Stop { disconnect }) => {
                        shutdown(&mut input, &mut requested, disconnect)
                    }
                    Err(TryRecvError::Disconnected) => shutdown(&mut input, &mut requested, false),
                    Ok(control @ (Control::Restore | Control::RestoreBack)) => {
                        if ready && requested.is_none() {
                            let command: &[u8] = if matches!(control, Control::Restore) {
                                b"restore\n"
                            } else {
                                b"restore-back\n"
                            };
                            let sent = input.as_mut().is_some_and(|pipe| {
                                pipe.write_all(command).and_then(|_| pipe.flush()).is_ok()
                            });
                            if !sent {
                                emit(Event::Routing {
                                    routing: "unknown".into(),
                                    success: Some(false),
                                    message: Some("无法向当前后端发送 Codex 切换请求。".into()),
                                });
                            }
                        }
                    }
                    Ok(control @ (Control::Import(_) | Control::ImportExisting)) => {
                        if ready && requested.is_none() {
                            let command = match control {
                                Control::Import(config) => format!(
                                    "{}\n",
                                    serde_json::json!({ "type": "import-config", "config": config })
                                ),
                                _ => "import-existing\n".into(),
                            };
                            if !input.as_mut().is_some_and(|pipe| {
                                pipe.write_all(command.as_bytes())
                                    .and_then(|_| pipe.flush())
                                    .is_ok()
                            }) {
                                emit(Event::Routing {
                                    routing: "unknown".into(),
                                    success: Some(false),
                                    message: Some("无法发送配置导入请求。".into()),
                                });
                            }
                        }
                    }
                    #[cfg(debug_assertions)]
                    Ok(Control::CrashForSmoke) => {
                        let _ = child.kill();
                    }
                    Err(TryRecvError::Empty) => {}
                }
                for event in events_rx.try_iter() {
                    if requested.is_some() {
                        continue;
                    }
                    match event.kind.as_str() {
                        "ready" if !ready => {
                            if let Some(url) = event.url {
                                ready = true;
                                emit(Event::Ready(url));
                            }
                        }
                        "error" => {
                            emit(Event::Error(
                                event.message.unwrap_or_else(|| "后端启动失败。".into()),
                            ));
                            shutdown(&mut input, &mut requested, false);
                        }
                        "profile" => emit(Event::Profile(event.attached.unwrap_or(false))),
                        "reconfigure" => emit(Event::Reconfigure(
                            event
                                .message
                                .unwrap_or_else(|| "设置已保存，正在重启代理…".into()),
                        )),
                        "routing" => emit(Event::Routing {
                            routing: event.routing.unwrap_or_else(|| "unknown".into()),
                            success: event.success,
                            message: event.message,
                        }),
                        _ => {}
                    }
                }
                if !ready && requested.is_none() && started.elapsed() > Duration::from_secs(75) {
                    emit(Event::Error("后端启动超时，可查看日志后重试。".into()));
                    shutdown(&mut input, &mut requested, false);
                }
                // Allow an admitted routing command (45 s), drain (60 s), then cleanup.
                if requested.is_some_and(|at| at.elapsed() > Duration::from_secs(130)) {
                    forced = true;
                    let _ = child.kill();
                }
                match child.try_wait() {
                    Ok(Some(status)) => {
                        emit(Event::Finished {
                            success: status.success() && !forced,
                            message: if forced {
                                "后端清理超时，已终止本应用的子进程；请检查日志。".into()
                            } else {
                                format!("后端已退出（{status}）。")
                            },
                        });
                        return Ok(());
                    }
                    Err(error) => {
                        let _ = child.kill();
                        let _ = child.wait();
                        return Err(error.into());
                    }
                    Ok(None) => {}
                }
                thread::sleep(Duration::from_millis(50));
            }
        };
        if let Err(error) = run() {
            emit(Event::Finished {
                success: false,
                message: format!("后端运行失败：{error}"),
            });
        }
    });
    tx
}
