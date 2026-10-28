---
type: bug
description: After an Expo app config edit, the Expo bridge panel and Problems keep the easProjectId result of the last status until Re-run Status, although the container resolves the project ID itself.
generated:
  by: claude-code/opus-5.5
  at: 2026-10-28T03:00:00Z
sources:
- resource: https://github.com/plume-works/vscode-expo-bridge
- resource: docs/knowledge/data/plans/20261026-expo-bridge-panel.md
---

# Bug: the Expo bridge's project ID diagnostic stays stale after a config edit

## Symptom

Removing `extra.eas.projectId` from the app config and running a status shows
the `easProjectId` diagnostic. Restoring the ID, in `app.json` or
`app.config.ts`, leaves the diagnostic and the panel's EAS project ID item
failing until **Re-run Status** is clicked.

## Reproduction

In an Expo consumer's Dev Containers window with 0.4.0 of the bridge:

1. Remove `extra.eas.projectId` from every app config file, then click **Re-run
   Status**. Problems shows the `easProjectId` diagnostic.
2. Restore the ID and save.

Expected: the diagnostic clears. Actual: it stays until the next status.

## Root cause

The config watcher clears the project ID cache and redraws the UI, but the UI
draws from the `StatusStore`, which holds the `easProjectId` check of the last
status result. Nothing resolves the ID again until the next `status` request
passes through `relayRequest`. The check needs no host call: the container
resolves it on its own.

## Fix

Not fixed. On a watched config change, resolve the folder's project ID again and
replace the `easProjectId` check in its stored status result, then redraw.

## Key references

Verified anchor points (line numbers as of 2026-10-28):

In `plume-works/vscode-expo-bridge` at `f269245`:

- `packages/workspace/src/extension.ts:126` — the config watcher; `:127` —
  `forget`, which clears the cache and calls `ui.refresh()` only
- `packages/workspace/src/statusstore.ts:18` — `record`, the only writer of a
  folder's status result
