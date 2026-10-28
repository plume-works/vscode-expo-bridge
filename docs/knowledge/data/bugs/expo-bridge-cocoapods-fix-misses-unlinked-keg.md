---
type: bug
description: The Expo bridge host's CocoaPods fix runs brew install cocoapods, which leaves an installed but unlinked keg unlinked, so pod stays off the PATH and the check stays failing.
generated:
  by: claude-code/opus-5.5
  at: 2026-10-28T03:00:00Z
sources:
- resource: https://github.com/plume-works/vscode-expo-bridge
- resource: docs/knowledge/data/plans/20261026-expo-bridge-panel.md
---

# Bug: the Expo bridge's CocoaPods fix does not repair an unlinked keg

## Symptom

With CocoaPods installed by Homebrew but unlinked, the `cocoapods` check fails
and the host offers **Install CocoaPods**. Running it prints "already installed,
it's just not linked" and changes nothing; the check stays failing.

## Reproduction

On a Mac with the host extension 0.4.0:

1. `brew unlink cocoapods`.
2. Run status, then **Fix…** → **Install CocoaPods**.

Expected: `pod` is back on the `PATH` and the check passes. Actual: the check
still fails.

## Root cause

The fix's only command is `brew install cocoapods`. Homebrew does not link an
installed keg on `install`, so the fix cannot reach a state where the keg exists
but its `pod` link does not.

## Fix

Not fixed. The fix could run `brew link cocoapods` when `brew list cocoapods`
succeeds, and `brew install cocoapods` otherwise. Low severity: only an explicit
unlink reaches this state.

## Key references

Verified anchor points (line numbers as of 2026-10-28):

In `plume-works/vscode-expo-bridge` at `f269245`:

- `packages/host/src/fix.ts:38` — the `cocoapods` step; `:42` — its single
  `brew install cocoapods` command
