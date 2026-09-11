# OpenCodex Desktop

在 OpenCodex 的同一个 fork 仓库内增加 Tauri 桌面能力，保留现有代理后端和管理界面。

目标平台先覆盖 Windows x64。安装后的应用提供独立窗口、系统托盘和完整的 OpenCodex 功能，并携带所需运行时，不依赖机器上全局安装的 OpenCodex、Node.js 或 Bun。开发环境可以使用这些工具。

## 当前阶段

已完成 M0 源码基线和 M1 最小 Tauri 开发预览：独立窗口加载本项目后端提供的原有管理界面。尚未接入托盘或生成桌面安装包。

- 上游：<https://github.com/lidge-jun/opencodex>
- 起点：`v2.50.0`
- 提交：`2d4d7a22381a2e497c2442902104619e25f937c7`
- 本地开发分支：`desktop/main`
- `upstream` 指向官方仓库；GitHub 账户下的远程 fork 和 `origin` 尚未配置。

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
- 关闭窗口会请求后端排空并清理本次运行记录；这一阶段没有托盘驻留。
- 全局安装、更新、系统重启及集成切换入口在开发预览中返回明确提示，后续由桌面生命周期统一接入。
- 启动失败可在提示页查看日志位置；每个会话目录保存 `backend.log` 和不含凭据的 `desktop-status.json`。

新填写的开发配置保留在对应会话目录，但下次启动会创建新会话。持久化正式配置、已有安装迁移及真实客户端切换属于 M2 / M3。

## 代码组织

| 位置 | 职责 |
| --- | --- |
| `src/` | 复用上游 Bun / TypeScript 后端，按需增加少量桌面适配 |
| `gui/` | 复用上游 React 管理界面，按需适配桌面交互 |
| `desktop/` | 放置 Tauri 窗口、托盘、进程管理及桌面打包代码 |
| `devlog/_plan/260911_tauri_desktop/` | 实施计划、验证记录 |

以一个产品、一套版本和一个安装包交付。允许必要的上游代码修改，保持改动集中、可解释；暂不拆分独立仓库、通用后端 SDK 或新的业务通信协议。

实施步骤和验收范围见 [桌面增强计划](../devlog/_plan/260911_tauri_desktop/010_plan.md)，本阶段的实现和验证见 [M1 验证记录](../devlog/_plan/260911_tauri_desktop/030_m1.md)。
