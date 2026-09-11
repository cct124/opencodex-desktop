---
title: Windows desktop fork
description: Persistent configuration and explicit Codex connection in the experimental Tauri desktop fork.
---

This page describes the experimental `desktop/main` branch of the
[cct124/opencodex-desktop fork](https://github.com/cct124/opencodex-desktop/tree/desktop/main).
It is not part of the upstream npm installer. The current executable needs its source checkout,
project-local Bun, and built dashboard; a self-contained Windows installer is still pending.

## Start and connect

Run the built `desktop/src-tauri/target/debug/opencodex-desktop.exe`. Settings persist under
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
their transport behavior. System installation and standalone updating remain disabled in the
managed dashboard while desktop integration and packaging are under development.
