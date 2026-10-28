---
type: task
created: 2026-10-26
stage: planned
priority: medium
description: Give the plume-works/vscode-expo-bridge extensions a marketplace icon and the bridge's status bar item and view container a recognisable icon.
generated:
  by: claude-code/opus-5.5
  at: 2026-10-26T04:20:00Z
sources:
- resource: https://github.com/plume-works/vscode-expo-bridge
- resource: https://code.visualstudio.com/api/references/extension-manifest
- resource: https://code.visualstudio.com/api/references/icons-in-labels
---

# Give the Expo bridge extensions icons

None of the bridge's manifests — `packages/host`, `packages/workspace`, and
`packages/pack` — sets `icon`, so the extension pack and both halves show the
generic placeholder in the Extensions view and on the marketplaces, where they
are hard to tell apart from each other and from unrelated Expo extensions.

The work:

- one marketplace icon (PNG, at least 128×128) per manifest, with the host and
  workspace halves distinguishable at a glance;
- an icon for the bridge's status bar item and for the activity-bar view
  container a bridge panel would add — a codicon, or a contributed icon font
  glyph, since status bar text takes only `$(name)` icons.
