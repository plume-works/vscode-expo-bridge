---
type: task
created: 2026-10-28
stage: planned
priority: high
description: Revise the Expo bridge panel's build controls to follow the CMake Tools extension's layout and behaviour, including a way to stop a running build, which the bridge has none of.
generated:
  by: claude-code/opus-5.5
  at: 2026-10-28T06:00:00Z
sources:
- resource: https://github.com/plume-works/vscode-expo-bridge
- resource: https://github.com/plume-works/vscode-expo-bridge/blob/main/docs/protocol.md
- resource: https://github.com/microsoft/vscode-cmake-tools
- resource: docs/knowledge/data/plans/20261026-expo-bridge-panel.md
---

# Revise the Expo bridge build controls after CMake Tools

A build started from the panel or from `eas-host build` cannot be stopped. A
local iOS build runs for minutes, and a wrong profile or an unwanted clean build
can only be waited out or ended by killing eas-cli on the Mac by hand.

The panel's build actions — **Build**, **Clean Build**, and **Change Build
Profile** in the view title — also need another revision. They should take the
layout and behaviour of the CMake Tools extension's build controls: the selected
profile shown where it can be changed, a build action that becomes a stop action
while a build runs, and the build's state visible while it runs.

The work:

- a way to stop a running build from the panel, and from `eas-host` on an
  interrupt;
- the panel's build controls revised after CMake Tools' layout and behaviour.

Stopping needs the host to end the eas-cli process it started, and a way for the
workspace to ask for that while the build request is still out. The protocol has
no such request today, and the host's runner keeps no handle to the child
process.

Anchors in `plume-works/vscode-expo-bridge` at `f269245`:
`packages/host/src/exec.ts:13` — `run`, which keeps no handle to the child;
`packages/host/src/build.ts:153` — the eas-cli run;
`packages/workspace/src/ui.ts:125` — the panel's `build`.
