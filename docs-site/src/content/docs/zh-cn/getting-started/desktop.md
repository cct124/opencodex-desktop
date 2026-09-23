---
title: 桌面 fork
description: 实验性桌面 fork 的 Windows 和 macOS 安装包、独立桌面版本与 Codex 连接。
---

本文介绍实验性的 [cct124/opencodex-desktop fork](https://github.com/cct124/opencodex-desktop)。
它不属于上游 npm 安装包。Windows x64 基础功能已通过手动测试；同时配置了 macOS Apple Silicon 和 Intel 构建，Mac 窗口与托盘仍需实机验收。当前安装包为开发产物，尚未发布稳定版本。

## 下载自动构建

每次分支推送都会触发 [Desktop installers](https://github.com/cct124/opencodex-desktop/actions/workflows/desktop-build.yml)。登录 GitHub，打开对应提交的运行，在 **Artifacts** 下载：Windows 选 `win32-x64`，Apple Silicon Mac 选 `darwin-arm64`，Intel Mac 选 `darwin-x64`。

每个下载包含安装文件、SHA-256 校验文件及记录提交、架构、桌面版/后端/Bun 版本的 `build-info.json`，保留 14 天。该平台必须完成构建和独立模拟提供方请求测试，才会上传产物。也支持手动运行工作流；测试使用模拟提供方，不使用模型密钥。

桌面版从 **0.1.0** 起独立维护，不再跟随后端版本。桌面控制页同时显示两个版本；管理页面原有徽标仍表示 OpenCodex 后端版本。维护时同步修改 `desktop-fork/package.json` 与 `desktop-fork/src-tauri/Cargo.toml`，运行 `cargo check --offline --manifest-path desktop-fork/src-tauri/Cargo.toml` 更新锁文件。构建会拒绝桌面版本不一致或混用构建资源。

此前安装 **2.50.0** Windows 测试包的用户，需要先退出、卸载并保留应用数据，再安装 **0.1.0**。这只在切换版本线时需要一次，后续正常递增升级；Windows 禁止降级的保护仍保留。

## 自动发布桌面版本

推送 `desktop-v<版本>` 标签后，同一工作流会构建三个平台的安装包，并自动发布到 [GitHub Releases](https://github.com/cct124/opencodex-desktop/releases)，标记为预发布。普通分支提交只生成测试包。维护者先同步更新桌面 package、Cargo 版本和锁文件，新增 `desktop-fork/releases/<版本>.md` 发布说明，再提交并推送代码。以当前 0.1.1 为例，在包含自动发布工作流的目标提交上执行：

```sh
git tag -a desktop-v0.1.1 -m "OpenCodex Desktop 0.1.1"
git push origin desktop-v0.1.1
```

标签必须与桌面版本完全一致，三个平台的构建和打包验收必须全部成功。发布前还会核对每个平台的提交、版本、文件列表及 SHA-256。附件包括三个安装包、三个校验文件和按平台命名的构建信息；Release 文件采用 `OpenCodex-Desktop_...` 名称，校验文件和构建信息也同步使用该名称。

附件先上传到草稿，全部验证后才公开。若上传中断，可在对应标签的 Actions 运行中重试失败任务，继续未发布草稿。已公开的完整版本和手动创建的发布会保留，不会覆盖；新文件应使用新版本，不移动已发布标签。当前标签发布统一为 Pre-release。只有标签发布任务具有 `contents: write` 权限，无需额外配置 PAT；上游 npm 发布流程独立运行。

## 安装与更新

NSIS 安装包携带桌面壳、固定版本 Bun、代理源码、生产依赖和完整管理页面。安装后无需源码目录，也无需全局安装 Node.js、Bun 或 OpenCodex。运行完整的 `OpenCodex Desktop_<version>_x64-setup.exe`；只复制桌面 exe 会缺少资源。安装范围为当前用户。若电脑尚未安装 WebView2，内置的 Microsoft 引导程序需要联网下载。

更新或卸载前，请从托盘选择退出，等待 Codex 配置恢复完成。桌面应用仍在运行时，Windows 安装程序会拒绝继续。更新通过完整安装包替换应用，管理页面的独立更新器不用于桌面安装。桌面控制页可打开 fork 的安装包 Actions 页面下载。Windows 安装程序禁止降级。

应用数据独立于安装目录，升级和默认卸载会保留数据；交互式卸载界面提供明确的删除应用数据选项。已导出的下载文件仍保留在用户的下载目录。

macOS 13 及以上系统打开对应架构的 `.dmg`，将完整应用拖入 Applications；替换前先退出旧应用。Mac 包采用 ad-hoc 签名，未使用 Apple 开发者签名或公证，因此 macOS 可能阻止首次启动，需要在隐私与安全设置中明确允许。参考 [Tauri 签名说明](https://v2.tauri.app/distribute/sign/macos/)。安装包携带原架构的 Bun 和生产依赖。

本地构建需要在目标原生架构上准备 Rust 1.92.0、Xcode Command Line Tools 和仓库指定的 Bun。按锁文件安装根目录、GUI 和 desktop 依赖后，执行 `cargo fetch --locked --manifest-path desktop-fork/src-tauri/Cargo.toml`，再执行 `bun run desktop-fork/scripts/build-installer.ts`。安装包和校验文件统一收集到 `desktop-fork/.bundle/artifacts/`。

## 启动与连接

从开始菜单打开 OpenCodex Desktop；源码开发可运行构建后的 `desktop-fork/src-tauri/target/debug/opencodex-desktop.exe`。
配置保存在 `%LOCALAPPDATA%/me.opencodex.desktop/`，退出重开后仍保留。关闭窗口会驻留托盘。
Mac 从 Applications 启动，数据目录为 `~/Library/Application Support/me.opencodex.desktop/`。
从其他 Windows 桌面软件启动时也使用同一数据目录。控制页显示已解析的实际路径，打开目录失败时会显示错误。
通过托盘打开桌面控制页，配置提供方，再明确启用 Codex 连接。页面会显示目标目录：启动环境的 `CODEX_HOME`，未设置时为用户的 `.codex`。首次连接前，后端使用独立的客户端目录。

首次连接会重启一次后端，之后恢复和接回不重启代理。退出应用会恢复原生配置，并保留连接偏好供下次启动使用。“恢复原生”或“停止代理”会取消自动连接。发现其他安装的路由或无法确认归属的记录时，保留原状态，提示先处理原安装。

从桌面版 **0.1.1** 起，若原进程已退出（或属于当前已授权后端）、路由已恢复原生且配套配置文件与原快照一致，残留恢复记录不会再阻止重装后连接。Codex 连接期间新增的设置会保留，下次连接以当前配置建立快照。遇到这种情况无需删除 `.codex` 目录或退出登录。无法读取、无法验证、仍被其他进程持有或尚未恢复完成的记录仍会保留并阻止连接。

如果启动检查明确报告配置或模型同步失败，桌面版会立即显示失败并停止后端，取消自动接入 Codex。请查看启动日志，重新启动代理检查设置，再手动接入。恢复记录在正常清理完成前保留，无法确认的客户端改动不会被覆盖。

## 导入配置

桌面控制页可在确认后导入原有 OpenCodex 的 `config.json` 或选择的 JSON 文件。导入会替换桌面配置并重启，旧桌面配置备份到应用数据目录的 `.opencodex/backups/`，源文件不变。
配置中的提供方密钥会被复制；OAuth 账户库、服务、PID 和原生恢复日志不随配置文件导入。环境变量引用仍保留为引用，不转换为文件中的密钥。

`desktop-fork/dev.ps1` 使用 `--preview` 创建独立开发会话。切换预览与持久化模式前，请退出已有实例。

持久化桌面模式的原生 Codex 请求使用现有上游 HTTPS/SSE 实现。普通 CLI 及明确启用 WebSocket 的第三方提供方保留原传输逻辑。

## 桌面控制与下载

管理页面保留提供方、模型、历史、路由和诊断功能，顶部桌面提示可打开本地控制页。停止、重启、系统安装、独立托盘、更新及重启 Codex 等入口转到桌面控制页。应用生命周期由桌面托盘管理，当前不安装开机启动或另一套全局服务。需要重启 Codex 本身时，请先完成当前轮次，再手动重启。

管理页面导出文件保存到用户的 `Downloads/OpenCodex Desktop/`，文件名前添加唯一前缀。桌面控制页的“打开下载目录”可打开该位置。外部 HTTP(S) 链接交给系统浏览器。管理页面不能直接调用原生命令；连接和进程操作通过本地桌面控制页完成。
