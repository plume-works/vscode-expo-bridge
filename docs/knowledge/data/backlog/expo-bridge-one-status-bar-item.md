---
type: task
created: 2026-10-28
stage: planned
priority: medium
description: Show one Expo Bridge status bar item instead of the host's fix item and the workspace's status item side by side, as part of the fix-flow rework.
generated:
  by: claude-code/opus-5.5
  at: 2026-10-28T03:00:00Z
sources:
- resource: https://github.com/plume-works/vscode-expo-bridge
- resource: docs/knowledge/data/plans/20261026-expo-bridge-panel.md
---

# Show one Expo Bridge status bar item

While a check fails, the status bar shows two items both named Expo Bridge: the
host's `Expo Bridge: N fix`, which opens the fix picker, and the workspace's
`Expo Bridge: N issues`, which opens the panel. They count the same failures in
different units, which reads as two problems.

The panel plan kept the host's fix item unchanged and left reworking the fix
flow to a follow-up. That rework should leave one item, the workspace's, whose
panel already offers the host's fixes.

Anchors in `plume-works/vscode-expo-bridge` at `f269245`:
`packages/host/src/extension.ts:257` — the host's fix item;
`packages/workspace/src/ui.ts:172` — the workspace's status item.
