---
type: bug
description: The Expo bridge's "Add a simulator build profile" quick fix inserts a profile without the bun pin that every eas.json build profile of a template consumer carries.
generated:
  by: claude-code/opus-5.5
  at: 2026-10-28T03:00:00Z
sources:
- resource: https://github.com/plume-works/vscode-expo-bridge
- resource: docs/knowledge/data/features/expo-eas-builds.md
- resource: docs/knowledge/data/plans/20261026-expo-bridge-panel.md
---

# Bug: the Expo bridge's simulator profile quick fix omits the bun pin

## Symptom

In a template consumer, every `eas.json` build profile sets `"bun"` to the
devcontainer's bun version. The profile the **Add a simulator build profile**
quick fix inserts has `developmentClient`, `distribution`, and `ios.simulator`,
but no `bun`.

## Reproduction

In a consumer whose profiles carry `"bun": "1.4.3"`, remove every profile with
`ios.simulator: true` and apply the quick fix. The inserted `development`
profile has no `bun` key.

## Root cause

The quick fix inserts a fixed object, `SIMULATOR_PROFILE`, and never reads the
pin from the file's other profiles or from the container's bun version.

## Fix

Not fixed. The inserted profile should copy `bun` from the existing profiles
when they agree on one, or else take the container's bun version.

## Key references

Verified anchor points (line numbers as of 2026-10-28):

In `plume-works/vscode-expo-bridge` at `f269245`:

- `packages/workspace/src/quickfix.ts:30` — `SIMULATOR_PROFILE`; `:45` —
  `simulatorProfileEdits`
