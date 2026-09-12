---
name: electron-security
description: Review Electron main, preload, renderer, IPC, navigation, and remote-content changes.
---

# Electron security

- Treat renderer input and remote content as untrusted.
- Preserve sandboxing, context isolation, disabled Node integration, CSP, and
  restricted navigation/window creation.
- Validate every IPC sender and payload. Expose narrow capability methods from
  preload; never expose raw `ipcRenderer` or Electron objects.
- Allow only explicitly safe external URL schemes and never pass unchecked URLs
  to `shell.openExternal`.
- Deny unexpected permission requests and review every new filesystem, process,
  network, or native-module capability.
- Add a regression test or documented threat-model note for security fixes.
