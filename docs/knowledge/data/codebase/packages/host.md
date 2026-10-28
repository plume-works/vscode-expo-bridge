---
type: codebase
description: The Mac-side ui extension that receives protocol requests through VS Code command routing, gates them on trust and build confirmation, and runs eas-cli, simctl, and the build cache on the Mac.
source: packages/host
source_digest: sha256:b35d8796548f71ac149f80b923ab38c0da382df4cc8dcfda1750eb9b39edd832
verified:
  by: claude-code/opus-5.5
  at: 2026-10-28T19:20:43Z
stale_after: 2027-01-26
generated:
  by: claude-code/opus-5.5
  at: 2026-10-28T19:20:43Z
sources:
- id: code
  resource: packages/host
---

# Host extension

`plume-works.vscode-expo-bridge-host`, `extensionKind: ui`, activated on
startup. It runs in the VS Code window on the Mac and does the work: every
action the container asks for runs here, under the Mac user's privileges, and
writes into the workspace only under `.tmp/expo-bridge/`.

## Contains

- `src/dispatch.ts` — validates a request and routes it to one action.
- `src/trust.ts` — per-workspace trust, build confirmation with cooldown,
  `EXPO_TOKEN` in secret storage.
- `src/hostpath.ts`, `src/container.ts`, `src/folder.ts` — the window's host
  path from its remote authority, its one container's bind mounts through
  `docker`, and the request folder's Mac path.
- `src/build.ts`, `src/buildkey.ts`, `src/fingerprint.ts`, `src/buildcache.ts`,
  `src/buildlog.ts` — `eas build --local`, reuse of a matching earlier artifact,
  and the streamed log.
- `src/install.ts`, `src/simulator.ts` — install, launch, and screenshot on a
  booted simulator.
- `src/status.ts`, `src/fix.ts`, `src/fixrun.ts`, `src/bunfix.ts`,
  `src/shell.ts` — the status checks and the Mac-side one-click fixes.
- `src/paths.ts`, `src/tar.ts`, `src/jsonfile.ts`, `src/env.ts`, `src/exec.ts`,
  `src/eascli.ts`, `src/port.ts` — path containment, archive safety, bounded
  JSON reads, the login environment, and process running.

## Public surface

- `expoBridge.ui.dispatch` — the one command the workspace extension calls with
  a protocol request.
- User commands: `expoBridge.setToken`, `clearToken`, `manageTrust`,
  `askBeforeEveryBuild`, `fix`.

## How it works

`activate` registers the dispatch command; each call assembles a fresh
`DispatchDeps` from this window's own remote authority — never the container's
claim — the login environment, and the trust store. `dispatch` rejects anything
outside the fixed action set, maps the folder before any action (an unmapped
folder never falls back to the window root), asks for trust on the first
`status`, puts `build` behind `confirmBuild`, and the other actions behind
`ensureTrusted`. A build computes a cache key from the project's
`expo/fingerprint` hash, the lockfiles, the profile, and the versions involved;
a hit copies the stored artifact in under a second, a miss runs
`bunx eas-cli@<spec> build --local` and stores a successful result.

## Depends on

- [Protocol package](protocol.md) — request, result, and error shapes.
- On the Mac: `docker`, Xcode's `xcrun simctl`, `bun`, `node`, `tar`.

## Invariants & gotchas

- Paths from the container are resolved with `resolveWithin` and opened with
  `O_NOFOLLOW_ANY`; a symlink anywhere below the root is rejected.
- Revoking a workspace's trust deletes its build cache.
- The cache keeps at most `MAX_ENTRIES` artifacts per folder, under a file lock
  that goes stale after `LOCK_STALE_MS`.
- Every build log chunk reaches the workspace before the response, which ends
  the stream.

## Key references

Verified anchor points (line numbers as of 2026-10-28):

- `packages/host/src/extension.ts:28` — `DISPATCH_COMMAND`
- `packages/host/src/extension.ts:247` — `activate`
- `packages/host/src/dispatch.ts:38` — `dispatch`
- `packages/host/src/trust.ts:59` — `TrustStore`
- `packages/host/src/trust.ts:102` — `TrustStore.ensureTrusted`
- `packages/host/src/trust.ts:119` — `TrustStore.confirmBuild`
- `packages/host/src/hostpath.ts:39` — `decodeHostPath`
- `packages/host/src/folder.ts:54` — `resolveFolder`
- `packages/host/src/build.ts:57` — `build`
- `packages/host/src/buildkey.ts:76` — `buildKey`
- `packages/host/src/fingerprint.ts:32` — `projectFingerprint`
- `packages/host/src/buildcache.ts:181` — `BuildCache`
- `packages/host/src/install.ts:68` — `install`
- `packages/host/src/status.ts:49` — `status`
- `packages/host/src/paths.ts:53` — `resolveWithin`
- `packages/host/src/fix.ts:22` — `planFixes`
