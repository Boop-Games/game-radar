; Custom NSIS hooks for the Game Radar installer (electron-builder `nsis.include`).
; Installs the Claude Code skill into the current user's profile, next to the app's own data,
; and removes it again on uninstall.

!define GR_SKILL_DIR "$PROFILE\.claude\skills\game-radar"

!macro customInstall
  CreateDirectory "${GR_SKILL_DIR}"
  CopyFiles /SILENT "$INSTDIR\resources\skill\SKILL.md" "${GR_SKILL_DIR}\SKILL.md"

  ; The launcher runs the bundled Electron runtime as plain Node, so no separate Node install is needed.
  ; It points at this install's files, so it is rewritten on every install and update.
  FileOpen $0 "${GR_SKILL_DIR}\game-radar.cmd" w
  FileWrite $0 "@echo off$\r$\n"
  FileWrite $0 "set ELECTRON_RUN_AS_NODE=1$\r$\n"
  FileWrite $0 `"$INSTDIR\Game Radar.exe" "$INSTDIR\resources\app.asar\bin\game-radar.mjs" %*$\r$\n`
  FileClose $0
!macroend

!macro customUnInstall
  Delete "${GR_SKILL_DIR}\SKILL.md"
  Delete "${GR_SKILL_DIR}\game-radar.cmd"
  RMDir "${GR_SKILL_DIR}"
!macroend
