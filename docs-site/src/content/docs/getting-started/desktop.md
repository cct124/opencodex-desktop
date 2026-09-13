---
title: Desktop fork
description: Windows and macOS installers, independent desktop versions, and explicit Codex connection in the experimental desktop fork.
---

This page describes the experimental
[cct124/opencodex-desktop fork](https://github.com/cct124/opencodex-desktop).
It is not part of the upstream npm installer. Windows x64 basic functionality has been manually
tested. macOS Apple Silicon and Intel builds are also configured; their window and tray behavior
still requires manual testing on a Mac. These are development packages, not stable releases.

## Download automated builds

Every branch push triggers [Desktop installers](https://github.com/cct124/opencodex-desktop/actions/workflows/desktop-build.yml).
Open the run for your commit and download its **Artifacts** while signed in to GitHub.
Choose `win32-x64` for Windows, `darwin-arm64` for Apple Silicon, or `darwin-x64` for Intel Mac.
Each artifact contains the installer, SHA-256 checksum, and `build-info.json` recording the commit,
architecture, desktop, proxy, and Bun versions. Artifacts expire after 14 days. Each platform must
pass its build and isolated mock-provider smoke test before upload. Manual workflow runs are also
supported. Tests use a mock provider and no model credentials.

Desktop versions start at **0.1.0** and are independent of OpenCodex's proxy version. The local
desktop controls display both; the dashboard's existing version badge continues to show the proxy
version. Maintainers update `desktop/package.json` and `desktop/src-tauri/Cargo.toml` together,
then run `cargo check --offline --manifest-path desktop/src-tauri/Cargo.toml` to refresh the lockfile.
Builds reject inconsistent desktop versions or resources from a different build.

If you installed the earlier Windows test package numbered **2.50.0**, exit and uninstall it
once, retaining app data, before installing **0.1.0**. Subsequent desktop upgrades use the new
version line; the Windows downgrade protection remains enabled.

## Publish desktop releases

Pushing a `desktop-v<version>` tag triggers the same three-platform build and then automatically
publishes a [GitHub prerelease](https://github.com/cct124/opencodex-desktop/releases). Ordinary branch
pushes only produce test artifacts. Before tagging, update the desktop package, Cargo version and
lockfile together, add `desktop/releases/<version>.md`, and commit and push those changes.
For the current 0.1.1 version, tag the intended commit containing the publishing workflow:

```sh
git tag -a desktop-v0.1.1 -m "OpenCodex Desktop 0.1.1"
git push origin desktop-v0.1.1
```

The tag must exactly match the desktop version. All three builds and packaged smoke tests must
succeed; publication also verifies every installer's commit, versions and SHA-256 checksum.
Release assets include three installers, their checksum files and three platform-specific build
metadata files. Portable `OpenCodex-Desktop_...` asset names are also used in their checksums and metadata.

Uploads are completed and verified in a draft before it becomes public. Retry failed jobs on the
tag run to resume an interrupted draft. Complete published releases and manually created releases
are preserved; use a new version for new binaries and never move published tags. Tag releases are
currently always prereleases. Only the tag-gated publish job has `contents: write`; no additional
personal access token is needed. The upstream npm release process is separate.

## Install and update

The NSIS installer includes the desktop shell, pinned Bun runtime, proxy source, production
dependencies, and complete dashboard. An installed app does not need a source checkout or a
global Node.js, Bun, or OpenCodex installation. Run the whole `OpenCodex Desktop_<version>_x64-setup.exe`;
copying the shell executable alone leaves out required resources. Installation is per user.
If WebView2 is missing, the embedded Microsoft bootstrapper needs an internet connection.

Before installing an update or uninstalling, choose **Exit** from the desktop tray menu and
wait for Codex restoration to finish. The installer refuses to continue while the desktop app
is running. Updates replace the whole app; the dashboard's standalone updater is not used.
Desktop controls link to the fork's installer workflow for downloads.
Downgrades are disabled. App data lives separately from installation files and is preserved
on upgrade and by default on uninstall; the interactive uninstaller offers an explicit option
to delete app data. Exported downloads remain in the user's Downloads directory.

On macOS 13 or later, open the `.dmg` for your architecture and drag the complete application
into Applications. Quit the existing app before replacing it. Mac packages use an ad-hoc
signature, without Apple Developer ID signing or notarization; macOS may block the first launch
and require explicit approval in Privacy & Security. See [Tauri's signing guide](https://v2.tauri.app/distribute/sign/macos/).
The package includes the native Bun executable and production dependencies. Build on the target
architecture with Rust 1.92.0, Xcode Command Line Tools, and the repository's pinned Bun version.
After frozen dependency installation and `cargo fetch --locked --manifest-path desktop/src-tauri/Cargo.toml`,
run `bun run desktop/scripts/build-installer.ts`. The installers and checksums are collected under
`desktop/.bundle/artifacts/`.

## Start and connect

Launch OpenCodex Desktop from the Start menu. For source development, use the built
`desktop/src-tauri/target/debug/opencodex-desktop.exe`. Settings persist under
`%LOCALAPPDATA%/me.opencodex.desktop/`. Closing the window keeps the proxy in the tray.
On Mac, launch from Applications; data lives under `~/Library/Application Support/me.opencodex.desktop/`.
Open the tray's desktop controls, configure providers, and explicitly enable the Codex connection.
The controls show the target home: the launch environment's `CODEX_HOME`, or the user's `.codex`.
Before the first connection, the backend uses an isolated client home.

The app uses the same data directory when launched from another Windows desktop application.
Desktop controls display its resolved location and report errors when opening the folder fails.

The first connection restarts the backend once. Later restore/reconnect operations keep it running.
Quitting restores native configuration and remembers the connection preference for the next launch.
Restoring native Codex or stopping the proxy cancels automatic reconnection. Unknown or foreign
routing is preserved and requires resolving the original installation first.

Starting with desktop **0.1.1**, a retained recovery journal no longer blocks reconnection after
reinstalling when the previous process has exited (or is this authorized backend), routing is
native, and the companion profile matches its original snapshot. Settings added while Codex was
connected are preserved; the next connection snapshots the current configuration. Do not delete
your `.codex` directory or sign out to resolve this case. Unreadable, unverified, live foreign, or
incompletely restored records remain protected and block connection.

If startup reports a configuration or model-sync failure, the desktop stops the backend and
shows the failure immediately. Automatic Codex reconnection is cancelled after failed startup.
Check the startup log, restart the proxy to review settings, then explicitly reconnect Codex.
Recovery records remain available until normal cleanup completes; ambiguous client edits are preserved.

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
