---
type: task
created: 2026-10-28
stage: planned
priority: medium
description: Give each section of the Expo bridge panel an icon that rolls up its items — green when all pass, else the icon of its most severe failing item — so a collapsed section still shows its state.
generated:
  by: claude-code/opus-5.5
  at: 2026-10-28T06:30:00Z
sources:
- resource: https://github.com/plume-works/vscode-expo-bridge
- resource: docs/knowledge/data/plans/20261026-expo-bridge-panel.md
---

# Show each Expo bridge panel section's state on its row

The panel's sections — Connection, Mac tools, Project, Trust & token, and
Simulator — have no icon of their own. Collapsed, a section hides whether any of
its checks fail, so a failing check is visible only with its section expanded.

Each section row should carry an icon summing up its items:

- the green pass icon when every item passes;
- otherwise the icon of its most severe failing item: error over warning.

Anchors in `plume-works/vscode-expo-bridge` at `f269245`:
`packages/workspace/src/panelmodel.ts:99` — `sectionNodes`, whose section nodes
set no `icon`; `:68` — `checkNode`, which sets each item's icon from its check's
severity.
