---
type: bug
description: The Expo bridge's host resolves every action to the devcontainer window's root folder, so an Expo app in a subdirectory or in another workspace folder cannot be checked or built, and `status` does not say which folder it inspected.
generated:
  by: claude-code/opus-5.5
  at: 2026-10-24T01:42:10Z
sources:
- resource: https://github.com/plume-works/vscode-expo-bridge
- resource: docs/knowledge/data/features/vscode-expo-bridge.md
- resource: docs/knowledge/data/architecture/vscode-expo-bridge.md
stage: done
---

# Bug: the Expo bridge builds only the devcontainer window's root folder

## Symptom

In a Dev Containers window on a Mac whose root folder is
`/workspaces/agent-devcontainer` (host path
`/Users/antonmatosov/Develop/agent-devcontainer`), with an Expo app added as a
second workspace folder at `.tmp/expo-bridge-t21/app`, `eas-host status` run
from the app's directory reports
`easCli: "eas-cli@latest (no cli.version in eas.json)"` and
`easProjectId: "extra.eas.projectId not set in app.json"`, although the app's
`eas.json` pins `cli.version` 25.3.0 and its `app.json` sets
`extra.eas.projectId`. Status inspected the window root, which has neither file,
and its output does not name the host path it inspected.
`eas-host build <profile>` resolves the same root, where `build` rejects the
request with `eas.json not found` before any confirmation. An Expo app in a
subdirectory of a single-folder window hits the same behavior.

Opening the app alone in another window on the same running container, through
**File: Open Folder**, does not help: with that window the only one open and its
bridge holding the socket, `status` still reports the same two details.

## Reproduction

1. On a Mac with `plume-works.vscode-expo-bridge` 0.2.0 installed, open a
   repository in a Dev Containers window.
2. Place an Expo app with `eas.json` and `app.json` in a subdirectory, then add
   its folder to the window as a second workspace folder, or open it alone with
   **File: Open Folder** in the running container.
3. From the app's directory, run `eas-host status`: `easCli` and `easProjectId`
   describe the window root, not the app.

## Root cause

The host extension resolves the workspace once per request from
`vscode.workspace.workspaceFolders?.[0]` and decodes the host path from that
folder's `dev-container+<hex JSON>` remote authority. That authority's
`hostPath` is the Mac folder the devcontainer was created from, whichever
container folder the window opens, by design: the container cannot redirect it,
because injecting a folder does not change the window's own authority. Neither
the `eas-host` request nor the dispatch carries a project location, so `status`,
`build`, and every file the host reads resolve against the root.

## Fix

Every request carries `folder`, the workspace folder containing `eas-host`'s
working directory (protocol version 2). The host requires it to be one of its
own window's workspace folders and maps it to a Mac path through the bind mounts
of the one running container Dev Containers labeled with the window's host path,
accepting only a path at or under the host path with no symlink component below
it. Every action reads and writes there, and `status` reports it as
`folderHostPath`; trust stays keyed to the host path. A window opened on the app
alone in the same container maps the same way.

## Key references

Verified anchor points (line numbers as of 2026-10-23):

In `plume-works/vscode-expo-bridge` at `69048dd`:

- `packages/host/src/extension.ts:103` — `resolveHostPath`, taking
  `workspaceFolders?.[0]` at line 104
- `packages/host/src/hostpath.ts:11` — `decodeHostPath`, the authority's
  `hostPath`
- `packages/host/src/dispatch.ts:52` — the null host-path gate in `dispatch`
- `packages/host/src/build.ts:51` — `build` reading `eas.json` at the host path
- `packages/host/src/status.ts:114` — the `easProjectId` failure detail
- `packages/host/src/status.ts:126` — the `easCli` "no cli.version" detail
- `packages/host/src/status.ts:134` — `readProjectId`, reading `app.json` at the
  host path
