---
type: codebase
description: How one eas-host build travels from the container's CLI through the window's socket and VS Code command routing to eas-cli on the Mac, and how its log and artifact come back.
source:
- packages
- docs/protocol.md
source_digest: sha256:0ea25cb1ac775bac3450d9c2e8cff83b781cc36c4107cf017eb312d3747abd7c
verified:
  by: claude-code/opus-5.5
  at: 2026-10-28T19:20:43Z
stale_after: 2027-01-26
generated:
  by: claude-code/opus-5.5
  at: 2026-10-28T19:20:43Z
sources:
- id: code
  resource: packages
---

# Flow: a build request

The path `eas-host build <profile>` takes, and the one every other action shares
up to the host's dispatch. The panel's Build button enters at step 4.

## Trace

1. `eas-host` parses argv, resolves its real `cwd`, and picks the live registry
   entry whose workspace folder contains it —
   `packages/workspace/bin/eas-host.ts:26`,
   `packages/workspace/src/registry.ts:128` ([Workspace
   extension](packages/workspace.md)).
2. It connects to that window's `<id>.sock` under `SOCKET_DIR` and writes one
   JSON line — `packages/protocol/src/index.ts:12` ([Protocol
   package](packages/protocol.md)).
3. The window's socket server completes the request with the containing
   workspace folder — `packages/workspace/src/artifacts.ts:30`.
4. `relayRequest` opens a build log stream for the folder and calls
   `expoBridge.ui.dispatch` — `packages/workspace/src/requests.ts:61`.
5. VS Code routes the command to the Mac; `dispatch` validates the action and
   maps the folder to its Mac path through the container's bind mounts —
   `packages/host/src/dispatch.ts:38`, `packages/host/src/folder.ts:54` ([Host
   extension](packages/host.md)).
6. `confirmBuild` asks for trust if needed and for this build unless a cooldown
   answer covers it — `packages/host/src/trust.ts:119`.
7. `build` computes the cache key and either copies a stored artifact
   (`mode: "reused"`) or runs `bunx eas-cli@<spec> build --local` and stores the
   result (`mode: "built"`) — `packages/host/src/build.ts:57`.
8. Each log write goes to `.tmp/expo-bridge/build-<ms>.log` and, through
   `expoBridge.workspace.buildLog`, back to the container, where the socket
   relays it as `log` frames; `eas-host` prints them to stderr —
   `packages/host/src/extension.ts:247`.
9. The response returns along the same path; `eas-host` prints the `BuildResult`
   JSON on stdout and exits 0.

## Failure modes

- No window contains `cwd`, or no socket answers: exit 3 before step 4.
- The folder does not map (no `docker`, not exactly one container, outside the
  host path, a symlink component): `unavailable`, exit 3.
- Trust or the confirmation declined: `untrusted` / `build-declined`, exit 1.
- Bad profile or missing `eas.json`: `bad-argument` / `not-found`, exit 1.
- eas-cli fails: the result carries its non-zero `exitCode`, with the log.
- The host half not installed: the dispatch command is missing, reported as such
  by the workspace extension.

## Key references

Verified anchor points (line numbers as of 2026-10-28):

- `packages/workspace/bin/eas-host.ts:26` — `main`
- `packages/workspace/src/registry.ts:128` — `selectEntry`
- `packages/workspace/src/artifacts.ts:30` — `resolveRequest`
- `packages/workspace/src/requests.ts:61` — `runRequest`
- `packages/host/src/dispatch.ts:38` — `dispatch`
- `packages/host/src/trust.ts:119` — `TrustStore.confirmBuild`
- `packages/host/src/build.ts:57` — `build`
