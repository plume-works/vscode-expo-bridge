---
type: task
created: 2026-10-28
stage: planned
priority: low
description: Make the vscode-expo-bridge sideload procedure for a consumer container verify which workspace extension build is running, so a stale VSIX or leftover copy cannot pass for the change under test.
generated:
  by: claude-code/opus-5.5
  at: 2026-10-28T03:00:00Z
sources:
- resource: https://github.com/plume-works/vscode-expo-bridge
- resource: docs/knowledge/data/plans/20261026-expo-bridge-panel.md
---

# Verify the build in the Expo bridge sideload procedure

The sibling repository's `AGENTS.md` installs packaged VSIX files on the Mac
and, for workspace changes, in the consumer's container. Nothing in it checks
that the container then runs the build under test. A VSIX copied into the
consumer earlier keeps its version number, so reinstalling it with `--force`
reports success while the old code runs; the container's extension folder also
keeps copies of earlier versions, including the pack and host halves that Dev
Containers installs from `devcontainer.json`.

The procedure should:

- copy the VSIX into the consumer immediately before installing it;
- uninstall the workspace extension first, and remove leftover
  `plume-works.vscode-expo-bridge*` folders in the container;
- confirm the installed `dist` contains a string unique to the change, then
  reload the window.
