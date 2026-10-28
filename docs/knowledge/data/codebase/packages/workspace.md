---
type: codebase
description: The container-side workspace extension — installs and serves the eas-host CLI over a per-window socket, relays requests to the host, and shows the Expo Bridge panel, status bar item, and Problems.
source: packages/workspace
source_digest: sha256:b47cdca4b61083322f2d9d8e7c5220df2a742693e6f3abf98ab7ebde33fc1be4
verified:
  by: claude-code/opus-5.5
  at: 2026-10-28T19:20:43Z
stale_after: 2027-01-26
generated:
  by: claude-code/opus-5.5
  at: 2026-10-28T19:20:43Z
sources:
- id: code
  resource: packages/workspace
---

# Workspace extension

`plume-works.vscode-expo-bridge-workspace`, `extensionKind: workspace`,
activated by `workspaceContains:eas.json`. It runs in the devcontainer, owns the
`eas-host` command agents call, and is the only half the container talks to; it
forwards each request to the host extension through VS Code command routing.

## Contains

- `bin/eas-host.ts` — the CLI, bundled to `dist/eas-host.js` ([eas-host
  CLI](../api-eas-host.md)).
- `src/cli-args.ts`, `src/wire.ts` — argv parsing, help text, and the
  newline-delimited JSON frames on the socket.
- `src/registry.ts` — the per-window `<id>.sock` / `<id>.json` registry and the
  longest-containing-folder window choice.
- `src/artifacts.ts`, `src/requests.ts` — completing a CLI request with its
  folder and newest artifact, relaying it, and collecting the build log.
- `src/appconfig.ts`, `src/easjson.ts` — the container's own reading of the
  project ID (`app.config.js` / `.ts` resolved) and of `eas.json`.
- `src/ui.ts`, `src/panel.ts`, `src/panelmodel.ts`, `src/statusbar.ts`,
  `src/statusstore.ts`, `src/buildterminal.ts` — the panel, status bar item, and
  `Expo Bridge Build` terminal.
- `src/checks.ts`, `src/issues.ts`, `src/diagnostics.ts`, `src/quickfix.ts`,
  `src/codeactions.ts`, `src/actions.ts` — failing checks as Problems with quick
  fixes.

## Public surface

- The `eas-host` launcher written to `~/.local/bin/eas-host` on activation.
- `expoBridge.workspace.buildLog` — receives the host's build log chunks.
- Panel commands `expoBridge.panel.*` and `expoBridge.quickfix.runInTerminal`;
  the `expoBridge.panel` view.

## How it works

`activate` writes the launcher, listens on `<SOCKET_DIR>/<id>.sock` with a
random id, and writes the registry entry naming this window's folders, rewriting
it when folders change. A socket connection carries one `CliRequest` with its
real `cwd`; `resolveRequest` picks the containing workspace folder and
`relayRequest` calls `expoBridge.ui.dispatch`. On a successful `status`, the
host's `easProjectId` check is replaced by the container's own resolution, so
the CLI and the panel agree. The panel sends the same requests through the same
relay.

## Depends on

- [Protocol package](protocol.md).
- [Host extension](host.md), reached only through `expoBridge.ui.dispatch`.

## Invariants & gotchas

- A failure to find `expoBridge.ui.dispatch` is reported as the host half not
  being installed, not as an action failure.
- Stale registry entries (dead `pid`) are pruned at activation; deactivation
  removes the window's own entry on a best-effort basis.

## Key references

Verified anchor points (line numbers as of 2026-10-28):

- `packages/workspace/src/extension.ts:38` — `installEasHost`
- `packages/workspace/src/extension.ts:74` — `activate`
- `packages/workspace/src/registry.ts:111` — `containingFolder`
- `packages/workspace/src/registry.ts:128` — `selectEntry`
- `packages/workspace/src/artifacts.ts:30` — `resolveRequest`
- `packages/workspace/src/requests.ts:61` — `runRequest`
- `packages/workspace/src/requests.ts:105` — `relayRequest`
- `packages/workspace/src/appconfig.ts:69` — `resolveProjectId`
- `packages/workspace/src/ui.ts:82` — `activateUi`
- `packages/workspace/src/diagnostics.ts:101` — `diagnosticsFor`
- `packages/workspace/src/quickfix.ts:61` — `quickFixesFor`
