---
type: codebase
description: The extension pack manifest that installs the host and workspace extensions together as plume-works.vscode-expo-bridge.
source: packages/pack
source_digest: sha256:ae86466ebff162427570f7a6a4dc7b3e0b48e12065ea3be71942a8eefc60313b
verified:
  by: claude-code/opus-5.5
  at: 2026-10-28T19:20:43Z
stale_after: 2027-01-26
generated:
  by: claude-code/opus-5.5
  at: 2026-10-28T19:20:43Z
sources:
- id: code
  resource: packages/pack
---

# Extension pack

`plume-works.vscode-expo-bridge`, the extension a devcontainer lists. It holds
no code: its `package.json` names the two member extensions in `extensionPack`,
and its README is the Marketplace page.

## Public surface

- `extensionPack` — `plume-works.vscode-expo-bridge-host` and
  `plume-works.vscode-expo-bridge-workspace`.
- `bun run package` here writes `vscode-expo-bridge.vsix`.

## Depends on

- [Host extension](host.md) and [Workspace extension](workspace.md), by
  extension id.

## Invariants & gotchas

- Its version is the one the host and workspace extensions carry ([Release
  tooling](release.md)).

## Key references

Verified anchor points (line numbers as of 2026-10-28):

- `packages/pack/package.json:18` — `extensionPack`
