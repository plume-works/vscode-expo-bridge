---
type: tracker
description: What the Expo Bridge is, who it is for, and the decisions every plan and spec derives from.
stage: living
generated:
  by: claude-code/opus-5.5
  at: 2026-10-28T16:40:00Z
sources:
- resource: README.md
- resource: package.json
- resource: docs/protocol.md
---

# Product

## What is it

Expo Bridge builds, installs, launches, and screenshots an Expo iOS app on the
Mac that opened a VS Code devcontainer, from inside that container.

A Linux devcontainer cannot build iOS; the Mac running VS Code has Xcode and the
iOS Simulator. The bridge is a VS Code extension pack: a workspace extension in
the container installs the `eas-host` command, and a host extension on the Mac
runs `eas build --local` and `xcrun simctl` behind a per-workspace trust prompt
and a per-build confirmation. A local build costs no EAS quota and lets the
developer and agents see the running app; when the bridge is unavailable, builds
fall back to EAS cloud.

It is pre-1.0: the pack and both extensions ship on the `0.x` lines, an odd
minor as a pre-release, to the Visual Studio Marketplace and Open VSX. The next
work is the backlog head.

## Users

- **Expo app developers** working in a VS Code devcontainer on a Mac. They
  install the host extension once per Mac, trust a workspace, and confirm each
  build.
- **Coding agents running in that container**, which build, install, launch, and
  screenshot the iOS app through `eas-host` without leaving the container.

Not for: hosts other than a Mac, Android builds, or production and CI builds,
which EAS cloud covers.

## Platforms

- The host extension runs on macOS with Xcode, the iOS Simulator, bun, and Node;
  the workspace extension runs in a Linux devcontainer.
- VS Code `^1.93.0` with Microsoft's Dev Containers extension, and VSCodium with
  `s-h-a-d-o-w.dev-containers-oss` (see `README.md`).
- Distributed as `plume-works.vscode-expo-bridge` on the Visual Studio
  Marketplace and Open VSX, published from a `vX.Y.Z` tag by
  `.github/workflows/release.yml`.
- A GitHub Codespace opened from VS Code on a Mac shares no folder with the Mac,
  so `eas-host status` reports the bridge unavailable there.

## Stack

TypeScript in a bun workspace (`package.json`):

- `packages/protocol/` — shared action, result, and error types and the protocol
  version
- `packages/host/` — the `ui`-kind host extension
- `packages/workspace/` — the `workspace`-kind extension and the `eas-host` CLI
- `packages/pack/` — the extension pack
- `packages/release/` — the version bump and release tag check

`bun install`, then `bun run lint` (prettier), `bun run typecheck` (tsc),
`bun test`, and `bun run package` for the three VSIX. `docs/protocol.md` is the
protocol and security contract.

## Constraints

- **A consent surface, not a security boundary.** The host accepts only the
  fixed Expo action set, never runs a command string from the container, writes
  into the workspace only under `.tmp/expo-bridge/`, and reads no security
  setting from a file the container can write. `build` runs only behind Mac-side
  per-workspace trust and a per-build confirmation.
- **Protocol compatibility.** `docs/protocol.md` is the contract. Host and
  workspace extensions of different versions keep working within one protocol
  version; an incompatible change raises it.
- **No network port.** Container-to-Mac traffic goes only through VS Code
  command routing; the bridge opens no listening port and needs no firewall
  allowlist change.
- License MIT; VS Code engine `^1.93.0`; published to both the Visual Studio
  Marketplace and Open VSX.

## Authoring rules

Canonical in `AGENTS.md` at the repository root (`CLAUDE.md` only includes it):

- JavaScript runs through `bun` and `bunx` only.
- Every change bumps the patch with `bun run bump`.
- `docs/protocol.md` changes in the same change as the code it describes.
- Scratch files go in `./.tmp/` at the repository root.
- Code anchors are verified against the current checkout, never cited from
  memory.

## Changelog

- 2026-10-28 — filled from the repository and the maintainer's answers; the
  bridge's design, plans, bugs, and backlog moved in from
  plume-works/agent-devcontainer.
