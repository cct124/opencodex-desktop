# 源码基线验证记录

日期：2026-09-11。

## 来源

- 仓库：<https://github.com/lidge-jun/opencodex>
- 标签：`v2.50.0`
- 提交：`2d4d7a22381a2e497c2442902104619e25f937c7`
- 开发分支：`desktop/main`
- 运行平台：Windows x64。

源码通过 Git 从官方仓库获取。开发工具 Bun 1.4.2 独立安装在本项目 `.tmp/toolchain/`，没有复制或调用全局安装的 OpenCodex。根目录和 GUI 依赖均使用 `--frozen-lockfile` 安装，锁文件未变。

## 可复现命令

以下命令在仓库根目录的 PowerShell 中运行。开发机需要可用的 Node.js / npm；这是源码构建前提，不是未来桌面安装包的运行依赖。

```powershell
npm.cmd install --prefix .tmp/toolchain --no-save --package-lock=false --no-audit --no-fund bun@1.4.2
$taskBun = (Resolve-Path '.tmp/toolchain/node_modules/bun/bin/bun.exe').Path
$env:PATH = (Split-Path $taskBun) + ';' + $env:PATH

& $taskBun --version
& $taskBun install --frozen-lockfile
& $taskBun run typecheck
& $taskBun run src/cli/index.ts --version
node bin/ocx.mjs --version
& $taskBun run build:gui
git diff --check
```

每条命令应检查退出码后继续。`build:gui` 包含 GUI 依赖安装、TypeScript 检查、Vite 生产构建和 `prepare:package`，因此可以生成可供后端加载的原始页面及兼容性清单。

## 结果

| 检查 | 结果 |
| --- | --- |
| 项目内 Bun | `1.4.2` |
| 根目录依赖安装 | 通过，使用上游锁文件 |
| GUI 依赖安装 | 通过，使用上游锁文件 |
| 后端 `typecheck` | 通过，退出码 0 |
| Bun 直接运行源码 CLI | 输出 `opencodex 2.50.0`，退出码 0 |
| Node 运行上游启动器 | 输出 `opencodex 2.50.0`，退出码 0；本项仅验证版本入口，不证明完整后端启动流程 |
| `build:gui` | 通过，退出码 0；生成 `gui/dist/index.html` 及资源 |
| `prepare:package` | 通过，生成 `src/generated/compatibility-version.json` |
| 上游跟踪文件 | 无修改；仅新增桌面说明和实施记录 |

初次 GUI 构建在受限沙箱内因 Vite 启动子进程出现 `spawn EPERM`。在正常权限环境重试后通过，没有为此修改源码或依赖。

Vite 报告原有主 JS chunk 超过 500 kB 的提示，构建未失败；本阶段不处理上游页面拆包。

## 验证边界与下一步

- 未启动代理服务，未接管真实 Codex 路由，未安装服务或托盘。
- 未运行全量测试，未验证真实模型请求、OAuth 或浏览器交互。
- 未实现 Tauri 工程、进程管理或桌面安装包；下一步进入 M1，验证窗口加载本项目独立启动的后端。
- 当前是带 `upstream` 的本地开发仓库，尚未创建 GitHub 远程 fork，也没有配置 `origin` 或推送代码。
- `.tmp/`、`node_modules/`、`gui/dist/` 和兼容性清单均由上游规则忽略，不属于提交内容。
