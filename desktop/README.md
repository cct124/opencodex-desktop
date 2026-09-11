# OpenCodex Desktop

在 OpenCodex 的同一个 fork 仓库内增加 Tauri 桌面能力，保留现有代理后端和管理界面。

目标平台先覆盖 Windows x64。安装后的应用提供独立窗口、系统托盘和完整的 OpenCodex 功能，并携带所需运行时，不依赖机器上全局安装的 OpenCodex、Node.js 或 Bun。开发环境可以使用这些工具。

## 当前阶段

已完成 M0 源码基线、M1 独立窗口、M2 托盘生命周期，以及 M3 的持久化配置和 Codex 接入。窗口加载本项目后端的原有管理界面；完整系统功能适配和安装包仍在后续阶段。

- 上游：<https://github.com/lidge-jun/opencodex>
- 起点：`v2.50.0`
- 提交：`2d4d7a22381a2e497c2442902104619e25f937c7`
- 本地开发分支：`desktop/main`
- `upstream` 指向官方仓库；`origin` 指向公开 fork <https://github.com/cct124/opencodex-desktop>。

## 启动与配置

构建后双击 `desktop/src-tauri/target/debug/opencodex-desktop.exe` 启动持久化模式。首次启动先配置提供方；从托盘打开“桌面状态与控制”，确认显示的 Codex 目录，点击“启用 Codex 代理并记住选择”。首次连接会重启一次后端，之后恢复与接回无需重启代理。

Windows 数据默认保存在 `%LOCALAPPDATA%/me.opencodex.desktop/`：

- `.opencodex/`：提供方、模型和代理设置；导入前的备份在 `backups/`。
- `connection.json`：连接选择、目标 Codex 目录和用于异常恢复的运行记录。
- `runs/`：每次应用启动的日志与状态。
- `webview/`：管理窗口的浏览器数据。

首次连接前不访问真实 Codex 目录。目标遵循启动环境的 `CODEX_HOME`，未设置时为用户的 `.codex`。已存在其他代理路由或无法确认归属的恢复记录时，提示先从原工具恢复，不停止原工具的进程。

“配置与数据”支持选择 JSON 文件，或导入原有 OpenCodex 的 `config.json`。导入需要在界面确认，会替换桌面设置、备份旧配置并重启；原文件保持不变。OAuth 登录、账户库、服务、PID 和恢复日志不在配置文件导入范围内，环境变量引用也不会变成内嵌密钥。

退出应用会恢复原生配置，重新打开时按上次连接选择接回代理。“恢复原生”或“停止代理”会取消自动连接。异常退出后，只有与本应用记录匹配且原后端已退出的路由才进入上游恢复流程。

## 隔离开发预览

在 Windows PowerShell 中，从仓库根目录运行：

```powershell
.\desktop\dev.ps1
```

首次需要完成 [基线依赖安装和 GUI 构建](../devlog/_plan/260911_tauri_desktop/020_baseline.md)，并安装 Rust、Windows C++ 构建工具及 WebView2。脚本按 `Cargo.lock` 构建，以 `--preview` 启动独立会话。

当前 exe 仍依赖本源码目录中的 Bun、后端和 GUI 产物；不能单独复制给其他机器当作完整应用。预览和持久化模式共享单实例入口，切换模式前请退出已有实例。

当前预览的行为：

- 每次启动在 `.tmp/desktop/session-*` 创建新的隔离配置，不读取已有提供方密钥，不接管当前 Codex。
- 自动选择本机回环端口；通过上游进程身份签名及 `/readyz` 检查后显示页面。
- 外部网页链接交给系统浏览器，管理页面没有桌面宿主命令权限。
- 单实例运行，再次打开应用会唤起已有窗口，不另起后端。
- 关闭窗口只隐藏到系统托盘，代理继续运行；左键单击托盘图标打开主窗口，右键打开菜单。
- 托盘菜单提供代理和 Codex 路由状态、启动、重启、原生停止与恢复操作、桌面控制页、日志目录和明确的退出入口。
- 停止代理保留应用和托盘；重启等待旧后端完成排空和配置清理，再创建新后端；退出同时停止本应用的后端。
- 后端异常退出时显示错误和重试入口，由用户手动启动恢复，不自动循环拉起。
- 全局安装、更新、系统重启及集成切换入口在开发预览中返回明确提示，后续由桌面生命周期统一接入。
- 启动失败可在控制页查看并打开日志目录；每次后端启动分别保存 `backend-1.log`、`backend-2.log` 等日志，另有不含凭据的 `desktop-status.json`。

预览模式下，同一次应用会话内停止、启动、重启和崩溃后重试复用配置；完全退出再启动创建新会话。持久化模式始终复用固定数据目录。

托盘和桌面控制页提供以下原生操作；当前开发预览仅修改独立会话中的 Codex 配置：

| 菜单 | 原生命令语义 | 操作后状态 |
| --- | --- | --- |
| 停止代理并恢复原生 Codex | `ocx stop` | 代理停止、Codex 恢复，桌面应用保留在托盘 |
| 恢复原生 Codex（代理继续运行） | `ocx restore` | Codex 恢复，代理和管理页面继续运行 |
| 将 Codex 重新接回当前代理 | `ocx restore back` | Codex 使用当前代理，代理进程不重启 |

“退出应用并恢复原生 Codex”会在代理完成清理后移除托盘并退出。点击窗口 X 只隐藏窗口，不触发上述操作。切换使用项目内原生 CLI；重复切换会暂时禁用，停止或退出会等待已开始的切换完成后再清理。重启保留重启前已启用的 Codex 代理路由。

桌面模式的请求排空时间沿用配置，最大 60 秒，额外留出清理时间。正常退出使用上游清理流程；超时强制结束或异常退出会明确报错，不声称配置恢复成功。现阶段系统开机启动、全局服务、上游托盘和自更新入口由桌面管理边界保护；恢复与连接通过桌面控制页和托盘执行。持久化模式的原生 Codex 上游请求采用 HTTPS/SSE，避免本次验证中观察到的 WebSocket 1011 关闭；普通 CLI 与显式开启 WebSocket 的第三方提供方保持原逻辑。

## 生命周期验证

构建 debug 程序后，可在 `desktop/` 中执行：

```powershell
& ..\node_modules\bun\bin\bun.exe test tests/runtime.test.ts tests/profile.test.ts tests/routing.test.ts tests/persistent.test.ts
& ..\node_modules\bun\bin\bun.exe run scripts/native-smoke.ts
& ..\node_modules\bun\bin\bun.exe run scripts/native-smoke.ts --startup-stop
& ..\node_modules\bun\bin\bun.exe run scripts/persistent-smoke.ts
& ..\node_modules\bun\bin\bun.exe run scripts/persistent-window-smoke.ts
```

运行前先从托盘退出已有开发实例。测试启动真实 Tauri / WebView2 窗口，检查关闭后可用性、第二实例唤起、Codex 接回与恢复、切换过程中停止、重启、崩溃恢复、退出清理和真实配置指纹；完成后自动退出。仅 debug 构建包含这些显式测试参数，管理页面没有测试控制权限。

真实账号测试需显式执行 `bun run scripts/native-account-smoke.ts --allow-native-request`。它用现有 Codex 登录发送简短请求，经本地桌面后端转发；令牌只在内存中使用，不复制、刷新或写回原生登录文件。这不同于在日常 Codex App 中手动发送一轮工具调用；后者以及完整业务页面仍需进一步验收。

## 代码组织

| 位置 | 职责 |
| --- | --- |
| `src/` | 复用上游 Bun / TypeScript 后端，按需增加少量桌面适配 |
| `gui/` | 复用上游 React 管理界面，按需适配桌面交互 |
| `desktop/` | 放置 Tauri 窗口、托盘、进程管理及桌面打包代码 |
| `devlog/_plan/260911_tauri_desktop/` | 实施计划、验证记录 |

以一个产品、一套版本和一个安装包交付。允许必要的上游代码修改，保持改动集中、可解释；暂不拆分独立仓库、通用后端 SDK 或新的业务通信协议。

实施步骤和验收范围见 [桌面增强计划](../devlog/_plan/260911_tauri_desktop/010_plan.md)，基线窗口验证见 [M1 验证记录](../devlog/_plan/260911_tauri_desktop/030_m1.md)，托盘和生命周期验证见 [M2 验证记录](../devlog/_plan/260911_tauri_desktop/040_m2.md)。
