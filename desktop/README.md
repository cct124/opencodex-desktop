# OpenCodex Desktop

在 OpenCodex 的同一个 fork 仓库内增加 Tauri 桌面能力，保留现有代理后端和管理界面。

目标平台先覆盖 Windows x64。安装后的应用提供独立窗口、系统托盘和完整的 OpenCodex 功能，并携带所需运行时，不依赖机器上全局安装的 OpenCodex、Node.js 或 Bun。开发环境可以使用这些工具。

## 当前阶段

已完成 M0 源码基线、M1 独立窗口开发预览，现已接入 M2 托盘和单实例生命周期。窗口加载本项目后端提供的原有管理界面；正式配置接管与安装包仍在后续阶段。

- 上游：<https://github.com/lidge-jun/opencodex>
- 起点：`v2.50.0`
- 提交：`2d4d7a22381a2e497c2442902104619e25f937c7`
- 本地开发分支：`desktop/main`
- `upstream` 指向官方仓库；`origin` 指向公开 fork <https://github.com/cct124/opencodex-desktop>。

## 启动开发预览

在 Windows PowerShell 中，从仓库根目录运行：

```powershell
.\desktop\dev.ps1
```

首次需要完成 [基线依赖安装和 GUI 构建](../devlog/_plan/260911_tauri_desktop/020_baseline.md)，并安装 Rust、Windows C++ 构建工具及 WebView2。脚本使用项目内 Bun 和用户 Rust 工具链，按 `Cargo.lock` 构建并启动应用。

构建后也可以直接打开 `desktop/src-tauri/target/debug/opencodex-desktop.exe`。此文件仍依赖本源码目录中的 Bun、后端和 GUI 产物；不能单独复制给其他机器当作完整应用。

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

同一次应用会话内停止、启动、重启和崩溃后重试均复用该会话的配置。完全退出应用后再启动会创建新会话；旧开发配置文件仍保留。持久化正式配置、已有安装迁移及真实客户端切换与 M3 完整功能适配一并实施。

托盘和桌面控制页提供以下原生操作；当前开发预览仅修改独立会话中的 Codex 配置：

| 菜单 | 原生命令语义 | 操作后状态 |
| --- | --- | --- |
| 停止代理并恢复原生 Codex | `ocx stop` | 代理停止、Codex 恢复，桌面应用保留在托盘 |
| 恢复原生 Codex（代理继续运行） | `ocx restore` | Codex 恢复，代理和管理页面继续运行 |
| 将 Codex 重新接回当前代理 | `ocx restore back` | Codex 使用当前代理，代理进程不重启 |

“退出应用并恢复原生 Codex”会在代理完成清理后移除托盘并退出。点击窗口 X 只隐藏窗口，不触发上述操作。切换使用项目内原生 CLI；重复切换会暂时禁用，停止或退出会等待已开始的切换完成后再清理。重启保留重启前已启用的 Codex 代理路由。

开发预览的请求排空时间沿用配置，最大 60 秒，额外留出清理时间。正常退出使用上游清理流程；超时强制结束或异常退出会明确报错，不声称配置恢复成功。现阶段系统开机启动、全局服务、上游托盘和自更新入口继续受开发预览保护，避免与桌面托盘重复管理进程。

## 生命周期验证

构建 debug 程序后，可在 `desktop/` 中执行：

```powershell
& ..\node_modules\bun\bin\bun.exe test tests/runtime.test.ts tests/profile.test.ts tests/routing.test.ts
& ..\node_modules\bun\bin\bun.exe run scripts/native-smoke.ts
& ..\node_modules\bun\bin\bun.exe run scripts/native-smoke.ts --startup-stop
```

运行前先从托盘退出已有开发实例。测试启动真实 Tauri / WebView2 窗口，检查关闭后可用性、第二实例唤起、Codex 接回与恢复、切换过程中停止、重启、崩溃恢复、退出清理和真实配置指纹；完成后自动退出。仅 debug 构建包含这些显式测试参数，管理页面没有测试控制权限。

## 代码组织

| 位置 | 职责 |
| --- | --- |
| `src/` | 复用上游 Bun / TypeScript 后端，按需增加少量桌面适配 |
| `gui/` | 复用上游 React 管理界面，按需适配桌面交互 |
| `desktop/` | 放置 Tauri 窗口、托盘、进程管理及桌面打包代码 |
| `devlog/_plan/260911_tauri_desktop/` | 实施计划、验证记录 |

以一个产品、一套版本和一个安装包交付。允许必要的上游代码修改，保持改动集中、可解释；暂不拆分独立仓库、通用后端 SDK 或新的业务通信协议。

实施步骤和验收范围见 [桌面增强计划](../devlog/_plan/260911_tauri_desktop/010_plan.md)，基线窗口验证见 [M1 验证记录](../devlog/_plan/260911_tauri_desktop/030_m1.md)，托盘和生命周期验证见 [M2 验证记录](../devlog/_plan/260911_tauri_desktop/040_m2.md)。
