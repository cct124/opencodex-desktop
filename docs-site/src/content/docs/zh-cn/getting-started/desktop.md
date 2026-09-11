---
title: Windows 桌面 fork
description: 实验性 Tauri 桌面 fork 的持久化配置与 Codex 连接。
---

本文介绍 [cct124/opencodex-desktop fork 的 desktop/main 分支](https://github.com/cct124/opencodex-desktop/tree/desktop/main)。
它不属于上游 npm 安装包。当前程序依赖源码目录、项目内 Bun 和已构建的管理页面；独立 Windows 安装包仍在开发中。

## 启动与连接

运行构建后的 `desktop/src-tauri/target/debug/opencodex-desktop.exe`。
配置保存在 `%LOCALAPPDATA%/me.opencodex.desktop/`，退出重开后仍保留。关闭窗口会驻留托盘。
通过托盘打开桌面控制页，配置提供方，再明确启用 Codex 连接。页面会显示目标目录：启动环境的 `CODEX_HOME`，未设置时为用户的 `.codex`。首次连接前，后端使用独立的客户端目录。

首次连接会重启一次后端，之后恢复和接回不重启代理。退出应用会恢复原生配置，并保留连接偏好供下次启动使用。“恢复原生”或“停止代理”会取消自动连接。发现其他安装的路由或无法确认归属的记录时，保留原状态，提示先处理原安装。

## 导入配置

桌面控制页可在确认后导入原有 OpenCodex 的 `config.json` 或选择的 JSON 文件。导入会替换桌面配置并重启，旧桌面配置备份到应用数据目录的 `.opencodex/backups/`，源文件不变。
配置中的提供方密钥会被复制；OAuth 账户库、服务、PID 和原生恢复日志不随配置文件导入。环境变量引用仍保留为引用，不转换为文件中的密钥。

`desktop/dev.ps1` 使用 `--preview` 创建独立开发会话。切换预览与持久化模式前，请退出已有实例。

持久化桌面模式的原生 Codex 请求使用现有上游 HTTPS/SSE 实现。普通 CLI 及明确启用 WebSocket 的第三方提供方保留原传输逻辑。在桌面集成和打包完成前，管理页中的系统安装与独立更新入口仍停用。
