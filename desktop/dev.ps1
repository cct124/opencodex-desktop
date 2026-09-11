$ErrorActionPreference = 'Stop'
$taskRepo = Split-Path $PSScriptRoot -Parent
$taskBun = Join-Path $taskRepo 'node_modules/bun/bin/bun.exe'
$taskCargo = Join-Path $env:USERPROFILE '.cargo/bin/cargo.exe'
if (-not (Test-Path -LiteralPath $taskBun)) { throw '缺少项目内 Bun，请先按 desktop/README.md 完成基线依赖安装。' }
if (-not (Test-Path -LiteralPath (Join-Path $taskRepo 'gui/dist/index.html'))) { throw '缺少 GUI 构建产物，请先运行 bun run build:gui。' }
if (-not (Test-Path -LiteralPath $taskCargo)) { throw '缺少 Rust 工具链，请安装 Rust 和 Windows C++ 构建工具。' }
& $taskCargo run --locked --manifest-path (Join-Path $PSScriptRoot 'src-tauri/Cargo.toml')
exit $LASTEXITCODE
