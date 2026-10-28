---
type: bug
description: The container does not see the Mac's build log grow while the host holds it open, so the Expo bridge streams no build log lines; the log appears only when the build ends and the host closes it.
generated:
  by: claude-code/opus-5.5
  at: 2026-10-28T06:09:33Z
sources:
- resource: https://github.com/plume-works/vscode-expo-bridge
- resource: docs/knowledge/data/plans/20261026-expo-bridge-panel.md
- resource: docs/knowledge/data/bugs/expo-bridge-build-log-tail-drops-lines.md
stage: done
---

# Bug: the container sees the Expo bridge's build log only after the build ends

## Symptom

A build started from the workspace panel or from `eas-host build` streams none
of the eas-cli output while the build runs. The panel's `Expo Bridge Build`
channel shows only its header line and the result line. The log file under
`.tmp/expo-bridge/` is complete afterwards.

## Reproduction

On an Apple silicon Mac with Docker Desktop and 0.4.0 of the bridge, in an Expo
consumer's Dev Containers window:

1. In a container terminal, print `date +%s.%N` and
   `stat -c 'size=%s mtime=%.Y'` of the newest `.tmp/expo-bridge/build-*.log`
   once a second.
2. Start a clean build from the panel.

The log appears within a second of its creation with the bytes of the host's
first `expo-bridge:` lines (147). Its size and mtime then stay fixed for the
whole build (about 100 s) and jump to the full log (59331 bytes) when the build
ends. The container's clock and the log's mtime agree to within a second.

## Root cause

The host writes the log through one file descriptor it opens at the start of a
build and closes at the end, with a `writeSync` per eas-cli output chunk. Over
Docker Desktop's file sharing of the Mac folder, the container sees the
attributes the file had when the writer last opened or closed it, so `fstat` in
`tailLog` keeps returning the size at creation. `tailLog` reads only up to that
size, and its final flush is a no-op ([the build log tail drops
lines](expo-bridge-build-log-tail-drops-lines.md)), so no eas-cli line is ever
passed on.

Eliminated: clock skew between the Mac and the container. `newestBuildLog`
filters on `mtimeMs >= since`, but the measured skew is under a second and the
log was found.

## Fix

Fixed by no longer reading the file from the container. The host passes each
chunk it writes to the log to the workspace command
`expoBridge.workspace.buildLog`, one call at a time, and drains every call
before it sends the build's response. The workspace splits the folder's chunks
into lines for `eas-host` and the panel's `Expo Bridge Build` channel. A failed
call stops the stream with a warning on the Mac; the log file stays complete.

## Key references

Verified anchor points (line numbers as of 2026-10-28):

In `plume-works/vscode-expo-bridge` at `0c15a5c`:

- `packages/protocol/src/index.ts:38` — `BUILD_LOG_COMMAND`
- `packages/host/src/build.ts:93` — `write`, which passes each log chunk to
  `onLog` as it writes it
- `packages/host/src/buildlog.ts:5` — `LogForwarder`; `:26` — `drain`
- `packages/host/src/extension.ts:296` — the forwarder for a `build` request;
  `:319` — draining it before the response
- `packages/workspace/src/requests.ts:23` — `BuildLogs`; `:34` — `open`, which
  splits a folder's chunks into lines; `:67` — `runRequest` opening it for a
  `build`
- `packages/workspace/src/extension.ts:136` — the `BUILD_LOG_COMMAND`
  registration
