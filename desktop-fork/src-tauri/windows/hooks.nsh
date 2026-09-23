; Data lives in LocalAppData/me.opencodex.desktop, outside the installation.
; Default uninstall preserves data; Tauri offers explicit deletion in its interactive UI.
; Never kill a process by its generic bun.exe name.
!macro OCX_REQUIRE_EXIT
  nsis_tauri_utils::FindProcessCurrentUser "opencodex-desktop.exe"
  Pop $0
  ${If} $0 == 0
    MessageBox MB_OK|MB_ICONEXCLAMATION "Please exit OpenCodex Desktop from its tray menu before installing or uninstalling. This lets it restore Codex settings safely." /SD IDOK
    Abort
  ${EndIf}
!macroend

!macro NSIS_HOOK_PREINSTALL
  !insertmacro OCX_REQUIRE_EXIT
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  !insertmacro OCX_REQUIRE_EXIT
!macroend
