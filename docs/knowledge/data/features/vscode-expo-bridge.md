---
type: feature
stage: implemented
description: Agents in a devcontainer opened by VS Code on a Mac build, install, launch, and screenshot an Expo iOS app on that Mac through the vscode-expo-bridge extension's fixed Expo-only action set, with EAS cloud as the fallback.
generated:
  by: claude-code/opus-5.5
  at: 2026-10-28T03:00:00Z
sources:
- resource: docs/knowledge/data/plans/20261026-expo-bridge-panel.md
- resource: docs/knowledge/data/plans/20261015-vscode-expo-bridge.md
- resource: docs/knowledge/data/plans/20261023-expo-bridge-workspace-folders.md
- resource: docs/knowledge/data/plans/20261023-expo-bridge-fingerprint-reuse.md
- resource: https://github.com/plume-works/vscode-expo-bridge
- resource: https://code.visualstudio.com/docs/devcontainers/containers
---

# VS Code Expo bridge

## Purpose

[Expo apps build for iOS through EAS](expo-eas-builds.md) from the Linux
devcontainer on Expo's cloud Macs. When VS Code opens that devcontainer on a
Mac, the Mac already has Xcode and the iOS Simulator; building there costs no
EAS quota and lets agents see the running app.

## Behaviour

**Two extensions in one pack.** `plume-works.vscode-expo-bridge`, built in its
own repository, bundles a workspace extension in the container and a host
extension on the Mac. The workspace extension installs the `eas-host` command;
the host extension runs the work.

**A fixed action set.** `eas-host` accepts only `status`, `build`, `install`,
`launch`, and `screenshot`. The Mac half never runs a command string from the
container, and writes into the workspace only under `.tmp/expo-bridge/`.

**The project is a workspace folder.** `eas-host` acts on the workspace folder
that contains its working directory, the longest one when folders nest, so an
Expo app opened as a second folder of a window is checked and built there.
`status` reports the folder's Mac path as `folderHostPath`.

**One window, one socket.** Several VS Code windows can share a container. Each
window's workspace extension serves its own socket, and `eas-host` connects to
the window whose workspace folder contains its working directory, so closing one
window leaves the others working.

**Trust lives on the Mac.** A devcontainer window already lets the container
reach the Mac through VS Code itself, so the bridge does not try to contain the
container; it adds no reach beyond that and gates its own build behind a person
on the Mac. The first request from a workspace asks the user on the Mac to trust
it; every build asks again, with "Don't ask for an hour" and "Don't ask today"
answers, and runs with the Mac user's own privileges. `EXPO_TOKEN` lives in VS
Code's secret storage on the Mac.

**Dev-client loop.** Metro runs in the container and VS Code forwards port 8081
to the Mac, so the native build reruns only when native code changes.

**A matching development build is reused.** A development build loads its
JavaScript from Metro, so when the project's native inputs are unchanged
`eas-host build` returns the workspace folder's earlier artifact in under a
second, without running eas-cli, and reports `mode: "reused"`. Any other build
runs in full and reports `mode: "built"` with a `reason`: `no-match`,
`no-fingerprint`, or `clean-requested`. `eas-host build <profile> --clean`
forces a full build, and its confirmation on the Mac names a clean build. A
build that embeds its JavaScript bundle, such as a Release build, is never
reused. Revoking a workspace's trust deletes its stored builds.

**A panel, a status bar item, and Problems.** The workspace extension adds an
`Expo Bridge` view to the activity bar, which shows each Expo folder's last
`status` in sections (Connection, Mac tools, Project, Trust & token, Simulator)
and offers Re-run status, Build, Clean build, and Change build profile. A build
started there streams its log to an `Expo Bridge Build` terminal, and the
folder's profile is remembered per user. A status bar item reads
`Expo Bridge: OK`, the number of issues, `unavailable`,
`Mac half not installed`, or `not checked`, and opens the view. Problems lists
each failing check, anchored to `eas.json` or the app config, with quick fixes:
the Mac's own fix, token, and trust prompts, `eas init` and Metro in a container
terminal, and a simulator build profile inserted into `eas.json`. The project ID
check reflects the resolved app config, `app.config.js` or `app.config.ts`
included, in the panel and in `eas-host status` alike.

**Template wiring.** The Expo profile lists the extension, forwards port 8081,
and tells agents to use `eas-host` for iOS when `eas-host status` succeeds.

## Edge cases

- **The bridge is unavailable** — not a Mac, or a tool missing.
  `eas-host status` says so and exits non-zero, and agents use EAS cloud builds.
- **Outside every workspace folder.** `eas-host` run in a directory no window's
  workspace folder contains names the directory and exits 3. An Expo app in a
  subdirectory that is not itself a workspace folder is added to the window as
  one.
- **The folder does not map.** The Mac half finds the folder's Mac path through
  the devcontainer's Docker bind mounts; without `docker` on the Mac, without
  exactly one running container for the window, or for a folder outside the
  window's host path, `status` is unavailable and no action falls back to the
  window root.
- **Mismatched halves.** The two extensions update separately, on the Mac and in
  the container; against a host on another protocol version `eas-host status`
  names both versions and exits 3.
- **The first window on a Mac.** The pack listed in `devcontainer.json` installs
  into the container, where the host extension is disabled; one click on its
  **Install Locally** installs it on the Mac for every window, after a **Reload
  Window** in windows already open.
- **A Mac tool is missing.** The extension offers a one-click fix in the VS Code
  UI; a fix runs only on the user's click, never from a protocol action.
- **Signed device and store builds** are not covered; the bridge builds for the
  simulator.

## Open questions

None — the plan settles the design.

## References

- Plan: [Build iOS on the Mac host through a VS Code
  bridge](../plans/20261015-vscode-expo-bridge.md)
- Plan: [Expo bridge acts on the agent's window and workspace
  folder](../plans/20261023-expo-bridge-workspace-folders.md)
- Plan: [Expo Bridge panel, status bar, and Problems in the workspace
  extension](../plans/20261026-expo-bridge-panel.md)
