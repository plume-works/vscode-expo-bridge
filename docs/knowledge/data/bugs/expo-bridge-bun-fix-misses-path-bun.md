---
type: bug
description: The Expo bridge's bun fix installs Homebrew's bun, but the bun check runs the first bun on the Mac's login PATH, so a stale bun.sh install ahead of Homebrew keeps the fix offered forever.
generated:
  by: claude-code/opus-5.5
  at: 2026-10-25T22:22:41Z
sources:
- resource: https://github.com/plume-works/vscode-expo-bridge
- resource: docs/knowledge/data/architecture/vscode-expo-bridge.md
- resource: docs/knowledge/data/plans/20261025-expo-bridge-bun-fix-resolved-bun.md
stage: done
---

# Bug: the Expo bridge's bun fix upgrades a bun the check never runs

## Symptom

In `plume-works.vscode-expo-bridge-host` 0.2.4 on a Mac, the status bar keeps
offering "Install or update bun — Mac bun 1.4.3 is older than the container's
1.4.4" after the fix runs. The fix terminal prints
`Warning: oven-sh/bun/bun 1.4.4 is already installed and up-to-date.`

## Reproduction

1. On a Mac, install bun through the bun.sh installer (`~/.bun/bin/bun`) at a
   version older than the container's, and Homebrew's `oven-sh/bun/bun` at the
   container's version, with `~/.bun/bin` ahead of `/opt/homebrew/bin` on the
   login shell's `PATH`. `which -a bun` lists `~/.bun/bin/bun` first.
2. Open a Dev Containers window on an Expo consumer of the agent-devcontainer
   template, with the host extension installed locally, and let `status` run.
3. Pick the bun fix from the Expo Bridge status bar item. The notice stays.

## Root cause

The bun check runs `lookupTool("bun", env)`, the first `bun` on the captured
login `PATH`. `withHomebrewPath` prepends the Homebrew prefixes only when the
`PATH` lacks them, so a login `PATH` that already lists `/opt/homebrew/bin`
after `~/.bun/bin` keeps the bun.sh copy first. The fix's only command is
`brew install oven-sh/bun/bun`, which changes Homebrew's copy and leaves the
binary the check runs untouched.

## Fix

The fix is in `plume-works.vscode-expo-bridge-host` 0.2.6
([plume-works/vscode-expo-bridge#24](https://github.com/plume-works/vscode-expo-bridge/pull/24)).
When the bun check fails, the host resolves the same first `bun` on the login
`PATH` and picks the fix by where that bun came from: `brew upgrade bun` when
its real path is under `/opt/homebrew/Cellar/`, `'<path>' upgrade` when it is
the bun.sh install, `brew install oven-sh/bun/bun` when there is none, and no
command, with a detail naming the path, otherwise. When a later bun on the
`PATH` already meets the container's version, a notice names both once per pair
of paths. The resolved path stays on the host; the protocol is unchanged.

## Key references

Verified anchor points (line numbers as of 2026-10-25):

In `plume-works/vscode-expo-bridge` at `f79cc6b`:

- `packages/host/src/bunfix.ts:35` — `resolveBunFix`; `:46` —
  `brew upgrade bun`; `:49` — the bun.sh `upgrade` by absolute path
- `packages/host/src/bunfix.ts:84` — `findShadowedBun`; `:122` — `ShadowNotes`
- `packages/host/src/fix.ts:22` — `planFixes`, taking the host's `BunFix`; `:59`
  — the bun step's commands; `:72` — `noCommandMessage`
- `packages/host/src/extension.ts:50` — `planHostFixes`; `:258` — `ShadowNotes`
  over `context.globalState`; `:379` — a step with no command shows its detail
- `packages/host/src/status.ts:106` — the bun check, unchanged
- `packages/host/src/build.ts:75` — `build` resolves the same bun
