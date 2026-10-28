---
type: bug
description: The Expo bridge's easProjectId status check reads only app.json, so a project whose app.config.js or app.config.ts sets, adds, or drops extra.eas.projectId gets the wrong answer.
generated:
  by: claude-code/opus-5.5
  at: 2026-10-28T06:09:33Z
sources:
- resource: docs/knowledge/data/plans/20261026-expo-bridge-panel.md
- resource: https://github.com/plume-works/vscode-expo-bridge
- resource: https://github.com/plume-works/vscode-expo-bridge/blob/main/docs/protocol.md
- resource: https://docs.expo.dev/workflow/configuration/
- resource: docs/knowledge/data/architecture/vscode-expo-bridge.md
stage: done
---

# Bug: the Expo bridge's project ID check ignores dynamic app config

## Symptom

`eas-host status` reports `easProjectId` as failing, with "extra.eas.projectId
not set in app.json", for a project that sets the ID in `app.config.ts` or
`app.config.js`. A project whose `app.json` holds the ID while its dynamic
config drops it reports the check as passing.

## Reproduction

Call the host's `status()` on a Mac-like fixture folder holding `eas.json` and:

1. only `app.config.ts`, exporting `expo.extra.eas.projectId` — the check
   reports `ok: false`;
2. `app.json` without the ID, plus `app.config.js` that adds it to the `config`
   it receives — `ok: false`;
3. `app.json` with the ID, plus `app.config.js` that returns `extra: {}` —
   `ok: true`.

## Root cause

`readProjectId` reads `<folder>/app.json` and looks for
`expo.extra.eas.projectId`; the protocol documents the check the same way. Expo
resolves the app config from `app.json` and then from `app.config.js` or
`app.config.ts`, which receives the static config and may add, change, or drop
any field, so `app.json` alone does not decide the resolved value.

The host cannot simply evaluate the dynamic config: outside a confirmed `build`,
it never evaluates project code ([VS Code Expo
bridge](../architecture/vscode-expo-bridge.md), Security model).

## Fix

Fixed by [Expo Bridge panel, status bar, and Problems in the workspace
extension](../plans/20261026-expo-bridge-panel.md). The container resolves the
ID, where evaluating project code crosses no trust boundary. `resolveProjectId`
runs the folder's own `node_modules/.bin/expo config --json --type public` and
reads `extra.eas.projectId`. Without a local `expo` it reads `app.json` as JSON
when no `app.config.*` exists, and otherwise reports the ID as unresolved,
naming the dynamic config. The workspace extension's `relayRequest` replaces
`checks.easProjectId` in every `status` result it relays with that answer, so
`eas-host status` and the panel report the resolved config. Results are cached
per folder until a watched app config, `eas.json`, or `package.json` changes.
The host's own check is unchanged and still never evaluates project code.

## Key references

Verified anchor points (line numbers as of 2026-10-28):

In `plume-works/vscode-expo-bridge` at `f269245`:

- `packages/workspace/src/appconfig.ts:69` — `resolveProjectId`; `:35` —
  `DYNAMIC_CONFIGS`; `:103` — `ProjectIdCache`
- `packages/workspace/src/requests.ts:85` — `projectIdCheck`; `:105` —
  `relayRequest`
- `packages/workspace/src/extension.ts:126` — the `PROJECT_ID_INPUTS_GLOB`
  watcher that clears the cache
- `packages/host/src/status.ts:118` — the host's `easProjectId` check; `:140` —
  `readProjectId`
- `docs/protocol.md:157` — the workspace extension's replacement of
  `easProjectId`
