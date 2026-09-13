# OpenCodex Desktop

在 OpenCodex 的同一个 fork 仓库内增加 Tauri 桌面能力，保留现有代理后端和管理界面。

目标平台覆盖 Windows x64 和 macOS（Apple Silicon、Intel）。安装后的应用提供独立窗口、系统托盘和完整的 OpenCodex 功能，并携带所需运行时，不依赖机器上全局安装的 OpenCodex、Node.js 或 Bun。开发环境可以使用这些工具。

## 当前阶段

已实现 M0 源码基线、M1 独立窗口、M2 托盘生命周期、M3 持久化配置和 Codex 接入。Windows 基础功能已通过手动验收；新增 macOS 安装包流水线，Mac 窗口与托盘仍需在实机验收。窗口加载原有完整管理界面，系统操作转到桌面控制页。安装包为开发产物，尚未发布稳定版本。

- 上游：<https://github.com/lidge-jun/opencodex>
- 起点：`v2.50.0`
- 提交：`2d4d7a22381a2e497c2442902104619e25f937c7`
- 桌面集成分支：`desktop/main`
- 公开 fork：<https://github.com/cct124/opencodex-desktop>。

## 自动构建与版本

每次向任意分支推送提交后，GitHub Actions 的 [Desktop installers](https://github.com/cct124/opencodex-desktop/actions/workflows/desktop-build.yml) 工作流自动构建，也支持手动运行。打开对应提交的成功运行，在 **Artifacts** 下载：

| 产物 | 系统 | 安装文件 |
| --- | --- | --- |
| `opencodex-desktop-win32-x64-<commit>` | Windows x64 | `.exe` |
| `opencodex-desktop-darwin-arm64-<commit>` | Mac Apple Silicon | `_aarch64.dmg` |
| `opencodex-desktop-darwin-x64-<commit>` | Mac Intel | `_x64.dmg` |

每个下载包含完整安装包、SHA-256 校验文件和记录提交、架构、桌面版/后端/Bun 版本的 `build-info.json`，保留 14 天。只有该平台的构建和隔离模拟请求测试成功后才上传；下载 Actions 产物需要登录 GitHub。测试使用模拟提供方，不使用账号登录或模型密钥。

桌面版从 **0.1.0** 起独立维护：同步修改 `desktop/package.json` 和 `desktop/src-tauri/Cargo.toml`，然后执行 `cargo check --offline --manifest-path desktop/src-tauri/Cargo.toml` 更新 `Cargo.lock`。Tauri 读取桌面 package 的版本，构建和测试会拒绝不一致。后端的根 `package.json` 保留上游版本；控制页同时显示两个版本，原管理界面的版本徽标仍表示 OpenCodex 后端。

以前标为 `2.50.0` 的 Windows 测试包需先退出并卸载，再安装 `0.1.0`；卸载时保留应用数据。此为一次性的版本线切换，之后桌面版正常递增升级，仍禁止直接降级。

### 自动发布到 Releases

普通分支提交生成测试包；推送与桌面版本匹配的 `desktop-v<版本>` 标签后，工作流自动构建并发布 [GitHub 预发布版本](https://github.com/cct124/opencodex-desktop/releases)。三个平台必须全部通过验收；发布任务还会核对提交、版本、文件列表与 SHA-256，再上传三个安装包、对应校验文件和按平台命名的构建信息。Release 附件使用 `OpenCodex-Desktop_...` 文件名，校验文件和构建信息同步使用该名称。

维护者先更新桌面 package、Cargo 和锁文件，并新增 `desktop/releases/<版本>.md` 发布说明，提交并推送代码。确认待发布提交后，以当前 `0.1.1` 为例：

```bash
git tag -a desktop-v0.1.1 -m "OpenCodex Desktop 0.1.1"
git push origin desktop-v0.1.1
```

只对尚未发布的新版本创建标签，不移动已有发布标签。标签提交必须包含本自动发布工作流。失败后可在该标签的 Actions 运行中重试失败任务；工作流会继续上传自己的未发布草稿，全部校验通过后才公开。已公开的完整版本和手动创建的发布不会被覆盖。

当前标签发布统一标记为 Pre-release。无需额外配置 PAT；只有标签发布任务具有仓库内容写权限，其余构建和校验任务保持只读。此桌面流程与上游 npm 发布相互独立。

## 本地安装包构建

从仓库根目录在 PowerShell 中构建（需先安装根目录和 GUI 的锁定依赖，以及 Rust / Windows C++ 构建工具）：

```powershell
& .\node_modules\bun\bin\bun.exe install --cwd desktop --frozen-lockfile
cargo fetch --locked --manifest-path desktop/src-tauri/Cargo.toml
& .\node_modules\bun\bin\bun.exe run desktop/scripts/build-installer.ts
& .\node_modules\bun\bin\bun.exe run desktop/scripts/package-smoke.ts
```

输出为 `desktop/src-tauri/target/release/bundle/nsis/OpenCodex Desktop_<version>_x64-setup.exe` 和同名 `.sha256`。固定 Tauri CLI、Rust 锁文件和 Bun 版本；生成脚本从允许列表复制资源、安装生产依赖并收集许可文件，不携带工作区配置、日志或开发笔记。`desktop-manifest.json` 用于构建与验收时检查资源哈希；程序启动时检查必需文件和版本，不将该清单宣称为数字签名。

Mac 上安装 Xcode Command Line Tools、Rust 1.92.0 和根 package 指定的 Bun，执行相同的 Bun/Rust 命令（将 Windows 的 Bun 路径替换为 `bun`）。必须在目标原生架构上构建，输出 `desktop/src-tauri/target/release/bundle/dmg/OpenCodex Desktop_<version>_<aarch64|x64>.dmg`；最低 macOS 13。打开 DMG，将完整应用拖入 Applications。构建采用 ad-hoc 签名，未作 Apple 开发者签名或公证，因此 macOS 可能阻止首次打开，需要在系统隐私与安全设置中明确允许。完整包验收还应运行：

```sh
codesign --verify --deep --strict "desktop/src-tauri/target/release/bundle/macos/OpenCodex Desktop.app"
bun run desktop/scripts/package-smoke.ts "desktop/src-tauri/target/release/bundle/macos/OpenCodex Desktop.app/Contents/Resources/runtime"
```

统一收集到 `desktop/.bundle/artifacts/` 的产物只属于本次构建。Mac 包含原架构的 Bun 和原生依赖，保留可执行权限，不携带 npm 命令符号链接。

安装后从开始菜单启动，无需源码目录或全局 Node.js、Bun、OpenCodex。当前为未签名开发安装包。安装仅针对当前用户；没有 WebView2 的电脑需要联网运行内置 Microsoft 引导程序。

升级、重装和卸载前需从托盘退出，等待配置恢复完成。Windows 安装程序不会强行终止运行中的桌面进程，不允许降级。升级和默认卸载保留应用数据；Windows 交互式卸载可明确勾选删除数据。桌面控制页提供 Actions 下载链接，使用完整安装包手动更新。开机启动和全局服务尚未接入。

管理页面的系统操作打开桌面控制页；如需重启 Codex，请先完成当前轮次，再手动重启。导出保存到 `Downloads/OpenCodex Desktop/`，控制页可打开下载目录。文件名带唯一前缀以避免覆盖。

## 启动与配置

构建后双击 `desktop/src-tauri/target/debug/opencodex-desktop.exe` 启动持久化模式。首次启动先配置提供方；从托盘打开“桌面状态与控制”，确认显示的 Codex 目录，点击“启用 Codex 代理并记住选择”。首次连接会重启一次后端，之后恢复与接回无需重启代理。

Windows 数据默认保存在 `%LOCALAPPDATA%/me.opencodex.desktop/`：

macOS 对应目录为 `~/Library/Application Support/me.opencodex.desktop/`，内部布局相同。

- `.opencodex/`：提供方、模型和代理设置；导入前的备份在 `backups/`。
- `connection.json`：连接选择、目标 Codex 目录和用于异常恢复的运行记录。
- `runs/`：每次应用启动的日志与状态。
- `webview/`：管理窗口的浏览器数据。

从其他 Windows 桌面软件启动时，应用也使用独立桌面运行环境，避免继承宿主的 AppData 重定向。控制页展示已解析的实际数据目录；打开目录失败会显示原因。

首次连接前不访问真实 Codex 目录。目标遵循启动环境的 `CODEX_HOME`，未设置时为用户的 `.codex`。已存在其他代理路由或无法确认归属的恢复记录时，提示先从原工具恢复，不停止原工具的进程。

从 **0.1.1** 起，已恢复原生配置的旧进程恢复记录不会再阻止重装后连接：桌面版核实原进程已退出（或属于当前已授权后端）、路由已恢复且配套配置文件与原快照一致，再按用户选择连接。Codex 在使用期间新增的设置会保留；不会用旧快照覆盖当前设置，也不需要删除 `.codex` 或重新登录。记录损坏、原进程仍在运行或配套配置仍有未恢复改动时，继续保留文件并拒绝接管。

“配置与数据”支持选择 JSON 文件，或导入原有 OpenCodex 的 `config.json`。导入需要在界面确认，会替换桌面设置、备份旧配置并重启；原文件保持不变。OAuth 登录、账户库、服务、PID 和恢复日志不在配置文件导入范围内，环境变量引用也不会变成内嵌密钥。

退出应用会恢复原生配置，重新打开时按上次连接选择接回代理。“恢复原生”或“停止代理”会取消自动连接。异常退出后，只有与本应用记录匹配且原后端已退出的路由才进入上游恢复流程。

后端明确报告配置或模型同步失败时，立即显示启动失败并停止后端，不继续等待 60 秒。失败的自动接入会被取消；修复日志中提示的问题后，可重新启动代理检查设置，再手动接入 Codex。恢复记录在正常清理完成前保留，无法确认的客户端改动不会被覆盖。

## 隔离开发预览

在 Windows PowerShell 中，从仓库根目录运行：

```powershell
.\desktop\dev.ps1
```

首次需要完成 [基线依赖安装和 GUI 构建](../devlog/_plan/260911_tauri_desktop/020_baseline.md)，并安装 Rust、Windows C++ 构建工具及 WebView2。脚本按 `Cargo.lock` 构建，以 `--preview` 启动独立会话。

debug exe 依赖本源码目录中的 Bun、后端和 GUI 产物；release 安装包从安装目录的 `runtime/` 加载资源。两种 exe 都不能脱离各自资源单独复制给其他机器。预览和持久化模式共享单实例入口，切换模式前请退出已有实例。release 构建不接受开发预览或测试参数。

当前预览的行为：

- 每次启动在 `.tmp/desktop/session-*` 创建新的隔离配置，不读取已有提供方密钥，不接管当前 Codex。
- 自动选择本机回环端口；通过上游进程身份签名及 `/readyz` 检查后显示页面。
- 外部网页链接交给系统浏览器，管理页面没有桌面宿主命令权限。
- 单实例运行，再次打开应用会唤起已有窗口，不另起后端。
- 关闭窗口只隐藏到系统托盘，代理继续运行；左键单击托盘图标打开主窗口，右键打开菜单。
- 托盘菜单提供代理和 Codex 路由状态、启动、重启、原生停止与恢复操作、桌面控制页、日志目录和明确的退出入口。
- 停止代理保留应用和托盘；重启等待旧后端完成排空和配置清理，再创建新后端；退出同时停止本应用的后端。
- 后端异常退出时显示错误和重试入口，由用户手动启动恢复，不自动循环拉起。
- 全局安装、更新和系统重启入口转到桌面控制页；集成切换由管理 API 返回明确提示，Codex 连接与恢复通过桌面控制页执行。
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

无窗口的 Windows 连接回归可从仓库根目录运行 `cargo run --locked --offline --manifest-path desktop/src-tauri/Cargo.toml --example runtime-probe -- persistent`。它复用正式应用的 Windows 进程启动逻辑，使用 `.tmp/desktop` 下的独立客户端夹具，并将结果写入 `.tmp/desktop/runtime-probe-persistent.log`。`package` 模式验证已暂存的安装包资源。登录 Windows 桌面后，可运行 `cargo test --locked --offline --manifest-path desktop/src-tauri/Cargo.toml windows_runtime::tests::child_runs_without_package_identity -- --ignored --exact` 验证子进程环境；它会主动执行两个子进程用例。这三个用例标记为 ignored，以免无桌面 Shell 的 CI 会话误执行交互环境检查。

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

以一个桌面产品、独立桌面版本和各平台完整安装包交付，保留所携带后端的上游版本。允许必要的上游代码修改，保持改动集中、可解释；暂不拆分独立仓库、通用后端 SDK 或新的业务通信协议。

实施步骤和验收范围见 [桌面增强计划](../devlog/_plan/260911_tauri_desktop/010_plan.md)，基线窗口验证见 [M1 验证记录](../devlog/_plan/260911_tauri_desktop/030_m1.md)，托盘和生命周期验证见 [M2 验证记录](../devlog/_plan/260911_tauri_desktop/040_m2.md)，安装包、回归对照和待验收项见 [M3 分发记录](../devlog/_plan/260911_tauri_desktop/060_m3_distribution.md)。
