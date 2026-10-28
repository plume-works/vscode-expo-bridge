---
type: bug
description: The Expo bridge's build log tail drops the lines written in the last poll interval before a build returns, and the start of any line it reads before the line's newline arrives.
generated:
  by: claude-code/opus-5.5
  at: 2026-10-28T06:09:33Z
sources:
- resource: https://github.com/plume-works/vscode-expo-bridge
- resource: docs/knowledge/data/architecture/vscode-expo-bridge.md
stage: done
---

# Bug: the Expo bridge's build log tail drops lines

## Symptom

`eas-host build` streams the host's build log to stderr while the build runs.
That stream loses lines in two ways:

- the lines eas-cli writes in roughly the last 250 ms before the build's
  response arrives never print;
- a line that is only partly written when a poll reads it prints only the part
  written after that poll.

The log file under `.tmp/expo-bridge/` is complete. Only the stream is affected.

## Reproduction

Call `tailLog` on an empty file, then:

1. append `one\nhal`;
2. wait 400 ms;
3. append `f\nlast\n`;
4. call the returned `stop()` at once.

The callback receives `["one"]`. Expected: `["one", "half", "last"]`.

## Root cause

`tailLog` has two faults:

- **The stop flush is a no-op.** `stop()` sets `closed = true` before its final
  `read()`, and `read()` returns early when `closed` is set.
- **Partial lines are thrown away.** `read()` advances `offset` past every byte
  it read, but passes on only the complete lines (`split("\n").slice(0, -1)`).
  The bytes of a partial line are dropped and never read again.

Both faults predate the workspace UI. The code moved unchanged from
`packages/workspace/src/extension.ts` to `requests.ts`, and the panel's
`Expo Bridge Build` output channel inherits them.

## Fix

Fixed by removing `tailLog` and `newestBuildLog`: the host now sends the build
log to the workspace by command ([the container sees the Expo bridge's build log
only after the build ends](expo-bridge-build-log-invisible-until-close.md)). The
workspace keeps an unended last line until the next chunk, and emits it when the
build's response arrives.

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
