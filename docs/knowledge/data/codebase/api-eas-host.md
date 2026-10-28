---
type: codebase
description: The eas-host command agents run in the container — its five actions, arguments, JSON output, exit codes, and the files it leaves under .tmp/expo-bridge/.
source:
- packages/workspace/bin/eas-host.ts
- packages/workspace/src/cli-args.ts
- packages/workspace/src/artifacts.ts
source_digest: sha256:75574daaee72ec7213f67ddc66a59a67351bc5607ab3ba41763806b118a10852
verified:
  by: claude-code/opus-5.5
  at: 2026-10-28T19:20:43Z
stale_after: 2027-01-26
generated:
  by: claude-code/opus-5.5
  at: 2026-10-28T19:20:43Z
sources:
- id: code
  resource: packages/workspace/bin/eas-host.ts
---

# Interface: eas-host CLI

Installed by the [Workspace extension](packages/workspace.md) as
`~/.local/bin/eas-host`, a launcher that runs the bundled script under `node`.
It acts on the workspace folder that contains the current directory.

## Commands

- `eas-host status` — the bridge's availability and every check, for this
  folder; sends the container's `bun --version`.
- `eas-host build <profile> [--clean]` — builds an `eas.json` profile; the
  result names `artifactRel`, `logRel`, `exitCode`, `mode`, and `reason`.
- `eas-host install [path]` — installs that artifact, or with no path the newest
  build artifact under `.tmp/expo-bridge/`.
- `eas-host launch` — starts the installed app.
- `eas-host screenshot` — captures the simulator; the result names
  `screenshotRel`.
- `eas-host help` (`--help`, `-h`) — the usage and the order to run them in.

## What a consumer can rely on

- One JSON object per run on stdout: the result, or the `ProtocolError`. Build
  log lines go to stderr.
- Exit codes: 0 success; 1 the action failed; 2 a usage error; 3 unavailable —
  no window contains the directory, no socket, `status` unavailable, or a host
  on another protocol version.
- Every file the bridge writes for a run lands under the folder's
  `.tmp/expo-bridge/`: `build-<ms>.log`, the artifact, `screenshot-*.png`.

## Key references

Verified anchor points (line numbers as of 2026-10-28):

- `packages/workspace/bin/eas-host.ts:26` — `main`
- `packages/workspace/bin/eas-host.ts:94` — `statusExit`
- `packages/workspace/src/cli-args.ts:23` — `HELP`
- `packages/workspace/src/cli-args.ts:75` — `parseArgs`
- `packages/workspace/src/artifacts.ts:15` — `newestArtifact`
