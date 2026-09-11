---
title: Windows desktop fork
description: Windows installer, persistent configuration, and explicit Codex connection in the experimental desktop fork.
---

This page describes the experimental
[cct124/opencodex-desktop fork](https://github.com/cct124/opencodex-desktop).
It is not part of the upstream npm installer. The Windows x64 installer workflow is under
development and does not yet represent a published stable release.

## Install and update

The NSIS installer includes the desktop shell, pinned Bun runtime, proxy source, production
dependencies, and complete dashboard. An installed app does not need a source checkout or a
global Node.js, Bun, or OpenCodex installation. Run the whole `OpenCodex Desktop_<version>_x64-setup.exe`;
copying the shell executable alone leaves out required resources. Installation is per user.
If WebView2 is missing, the embedded Microsoft bootstrapper needs an internet connection.

Before installing an update or uninstalling, choose **Exit** from the desktop tray menu and
wait for Codex restoration to finish. The installer refuses to continue while the desktop app
is running. Updates replace the whole app; the dashboard's standalone updater is not used.
Desktop controls link to the fork's releases page for manually published installers.
Downgrades are disabled. App data lives separately from installation files and is preserved
on upgrade and by default on uninstall; the interactive uninstaller offers an explicit option
to delete app data. Exported downloads remain in the user's Downloads directory.

## Start and connect

Launch OpenCodex Desktop from the Start menu. For source development, use the built
`desktop/src-tauri/target/debug/opencodex-desktop.exe`. Settings persist under
`%LOCALAPPDATA%/me.opencodex.desktop/`. Closing the window keeps the proxy in the tray.
Open the tray's desktop controls, configure providers, and explicitly enable the Codex connection.
The controls show the target home: the launch environment's `CODEX_HOME`, or the user's `.codex`.
Before the first connection, the backend uses an isolated client home.

The first connection restarts the backend once. Later restore/reconnect operations keep it running.
Quitting restores native configuration and remembers the connection preference for the next launch.
Restoring native Codex or stopping the proxy cancels automatic reconnection. Unknown or foreign
routing is preserved and requires resolving the original installation first.

## Import settings

Desktop controls can import an existing OpenCodex `config.json` or a selected JSON file after
confirmation. This replaces desktop settings and restarts the backend. The previous desktop
configuration is backed up under `.opencodex/backups/` in the app data directory; the source file
is unchanged. Provider keys in the configuration are copied, but OAuth account stores, service
definitions, PID records and native recovery journals are not imported. Environment references
remain references and are not converted into stored credentials.

`desktop/dev.ps1` uses `--preview` for disposable, isolated development sessions. Exit an existing
instance before switching between preview and persistent modes.

Native Codex requests in persistent desktop mode use HTTPS/SSE with the existing upstream
implementation. Standalone CLI and explicitly opted-in third-party WebSocket providers retain
their transport behavior.

## Desktop controls and downloads

The dashboard keeps its existing provider, model, history, routing, and diagnostics pages.
Its desktop notice opens the local controls. Stop, restart, system installation, standalone
tray, update, and Codex restart entry points hand off to those controls. Desktop lifetime is
managed by the tray; automatic startup and a second global service are not installed.
If Codex itself needs restarting, finish its current turn and restart it manually.

Dashboard exports are saved under `Downloads/OpenCodex Desktop/`, with a unique prefix on
the suggested filename. **Open download folder** in desktop controls opens that directory.
External HTTP(S) links open in the system browser. The dashboard cannot invoke native host
commands; connection and process changes use the local desktop controls.
