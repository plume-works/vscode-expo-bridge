---
type: bug
description: Every Expo bridge workspace extension in a container listens on the one fixed socket `/tmp/vscode-expo-bridge.sock` and deletes it on activation and on shutdown, so with two VS Code windows on the same container the last window to start takes the socket and the first to close leaves `eas-host` with no host.
generated:
  by: claude-code/opus-5.5
  at: 2026-10-24T01:42:10Z
sources:
- resource: https://github.com/plume-works/vscode-expo-bridge
- resource: docs/knowledge/data/features/vscode-expo-bridge.md
- resource: docs/knowledge/data/bugs/expo-bridge-builds-only-window-root.md
stage: done
---

# Bug: Expo bridge windows sharing a container break each other's socket

## Symptom

With `plume-works.vscode-expo-bridge-workspace` 0.2.2, two VS Code windows were
attached to the same devcontainer: one on the repository root with an Expo app
as a second folder, and one opened on the Expo app alone. After the first window
closed, `eas-host status` in the container printed
`expo bridge unavailable (no VS Code host); use EAS cloud` and exited 3,
although the app window's workspace extension had activated and was still
running. `/tmp/vscode-expo-bridge.sock` no longer existed.

While both windows are open, whichever activated last owns the socket, so
`eas-host` in either window reaches that window's extension and its workspace
root, not necessarily the window the agent works in.

## Reproduction

1. Open window A on a devcontainer whose workspace contains `eas.json`, with the
   bridge pack installed.
2. Open window B on the same running container with a folder that contains
   `eas.json` (for example **File: Open Folder** on an Expo app inside it).
   Window B's extension deletes A's socket and listens on the same path.
3. Close window A.
4. In the container, run `eas-host status`: it exits 3 with "no VS Code host".
   **Developer: Reload Window** in window B restores the socket.

## Root cause

The socket path is one constant for every window: `SOCKET_PATH` is
`/tmp/vscode-expo-bridge.sock`. On activation the workspace extension removes
whatever is at that path and listens there; on deactivation it closes its own
server and removes the path again without checking that the socket there is
still its own. The `eas-host` launcher connects to the same constant, so nothing
distinguishes one window's server from another's.

## Fix

Each window's workspace extension serves its own
`/tmp/vscode-expo-bridge/<id>.sock` next to a registry entry, `<id>.json`,
naming its process, activation time, and workspace folders. It removes only its
own two files, and prunes entries whose process is gone. `eas-host` connects to
the window with the longest workspace folder containing its working directory,
the most recently activated on a tie, so closing one window leaves the others
reachable.

## Key references

Verified anchor points (line numbers as of 2026-10-23):

In `plume-works/vscode-expo-bridge` at `63fc991`:

- `packages/protocol/src/index.ts:9` — `SOCKET_PATH`, the one fixed path
- `packages/workspace/src/extension.ts:121` — `rmSync(SOCKET_PATH)` before
  listening, removing another window's socket
- `packages/workspace/src/extension.ts:142` — `server.listen(SOCKET_PATH)`
- `packages/workspace/src/extension.ts:148` — `rmSync(SOCKET_PATH)` on dispose,
  without an ownership check
- `packages/workspace/bin/eas-host.ts:39` — `eas-host` connecting to
  `SOCKET_PATH`
- `packages/workspace/bin/eas-host.ts:70` — the "no VS Code host" message
