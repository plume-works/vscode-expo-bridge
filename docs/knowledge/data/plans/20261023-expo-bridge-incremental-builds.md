---
type: plan
created: 2026-10-23
release:
- features/vscode-expo-bridge
description: Make a repeat `eas-host build` of an Expo iOS app on the Mac reuse the previous build's working directory, pods, and DerivedData from a per-workspace cache in the host extension's private global storage, with `eas-host build <profile> --clean` and a Mac-side Clean Build Cache command for a fresh build, the build mode reported in the result, disk use shown and capped, and protocol version 2 — spiked on a Mac before the details are designed.
generated:
  by: claude-code/opus-5.5
  at: 2026-10-23T18:22:28Z
sources:
- resource: docs/knowledge/data/plans/20261015-vscode-expo-bridge.md
- resource: https://github.com/plume-works/vscode-expo-bridge
- resource: https://github.com/plume-works/agent-expo-bridge-spikes
- resource: https://docs.expo.dev/build-reference/local-builds/
- resource: https://github.com/expo/eas-build
- resource: https://www.npmjs.com/package/eas-cli-local-build-plugin/v/25.3.0
stage: cancelled
status: deprecated
---

# Incremental local iOS builds for the VS Code Expo bridge

## Context

The [VS Code Expo bridge](../features/vscode-expo-bridge.md), built by the
[bridge plan](20261015-vscode-expo-bridge.md), runs every `eas-host build` as a
full rebuild. `eas build --local` copies the project into a fresh
`eas-build-local-nodejs/<uuid>` working directory under macOS's `$TMPDIR`,
installs every package and every pod, compiles every pod and the app from
scratch, and deletes the working directory when the build ends. A second build
reuses nothing except the Mac-wide bun and CocoaPods download caches ([bridge
plan](20261015-vscode-expo-bridge.md), Task 10). Whether Ccache is in effect is
settled by Task 2. The goal is for a repeat build to reuse the previous build's
outputs, so a native change costs one incremental Xcode build.

eas-cli's local build reads `EAS_LOCAL_BUILD_WORKINGDIR` (where to build) and
`EAS_LOCAL_BUILD_SKIP_CLEANUP` (keep that directory afterwards). What it does
with a working directory that already exists is open; Task 1 settles it.

## Approach

The host extension keeps one build cache per workspace host path, under
`<globalStorage>/build-cache/<sha256 of the host path>/`. `build` points
`EAS_LOCAL_BUILD_WORKINGDIR` at that cache's working directory, sets
`EAS_LOCAL_BUILD_SKIP_CLEANUP=1`, and keeps the installed packages, the pods,
and Xcode's DerivedData there between builds. Every piece of state a build
reuses lives inside that one directory: no workspace's build reads another
workspace's cache, and deleting the directory leaves nothing behind. The
Mac-wide bun and CocoaPods download caches stay shared, as they are today.

A build is **incremental** when it starts from an existing cache whose recorded
inputs still match, and **clean** otherwise. Before the build starts the host
wipes the cache in four cases: there is no cache yet, the request asks for a
clean build, a recorded input changed, or the previous build in the cache did
not finish. A recorded input is a value the host reads without running project
code, such as the profile name or the eas-cli version. The spike (Tasks 1–4)
settles which inputs count, and Task 5 writes them into this plan.

**A clean build in two shapes:**

- `eas-host build <profile> --clean` sends `clean: true`, the only argument the
  protocol adds. It goes through the same trust and per-build confirmation as
  any build, and the confirmation names it a clean build.
- **"Expo Bridge: Clean Build Cache"**, a Mac-side command, lists each cached
  workspace's host path and size and deletes the one the user picks after a
  modal. Like the other management commands, it takes no arguments, returns
  nothing, and changes nothing until the user answers the modal.

**Reporting and disk.** A build's result carries `mode` (`incremental` or
`clean`) and, for a clean build, `cleanReason`. `status` reports this
workspace's cache size. Before each build the host evicts other workspaces'
caches, least recently built first, until the total is under a fixed cap. It
never evicts the cache of the workspace that is building. Revoking a workspace's
trust decision deletes its cache. Only one build runs per workspace at a time: a
second request fails while the first holds the cache.

**Protocol version 2.** Adding `clean` to the request and `mode` to the result
raises `PROTOCOL_VERSION` to 2. `eas-host status` already exits 3 and names both
versions on a mismatch, so a host on version 1 never silently ignores `--clean`.

The security model is unchanged. Trust is per workspace and every build is
confirmed. The host still writes into the workspace only under
`.tmp/expo-bridge/`, under the fresh-write rule, and the artifact is still built
in private global storage. No project code runs outside `build`; the cache only
moves where `build` runs it.

Rejected: skipping a build when `@expo/fingerprint` matches the previous one.
Computing a fingerprint evaluates `app.config.js` and config plugins, which is
project code outside `build`, and it saves only the no-change case. Rejected:
keeping DerivedData in Xcode's default `~/Library/Developer/Xcode/DerivedData`.
It would sit outside the per-workspace directory, so clean, eviction, and trust
revocation could not remove it. Rejected: a cap or a cache location read from VS
Code settings. Workspace-scoped settings are files the container can write.

Assumptions:

- The cap is a constant in the host extension, sized in Task 5 from the cache
  size the spike measures.
- A build that fails before it finishes leaves its cache marked unfinished, so
  the next build is clean (`cleanReason: "previous-build-unfinished"`), unless
  Task 1 shows a failed build leaves state that is safe to reuse.
- A second build request for a workspace whose build is running fails with
  `action-failed` and the message "a build is already running for this
  workspace"; no new error code.
- The Clean Build Cache command refuses to delete a cache while that workspace's
  build is running.

## Implementation Steps

### Task 1: Spike reuse of an existing working directory

**Files:** none — the bridge plan's scratch app, on a Mac, driven through the
spike bridge in `plume-works/agent-expo-bridge-spikes`

- [x] What eas-cli does when `EAS_LOCAL_BUILD_WORKINGDIR` names a directory a
  previous build left: re-copies the project over it, wipes it, or refuses.
  - **Evidence:** refuses — `eas-cli-local-build-plugin@25.3.0`
    `dist/workingdir.js:15-16`, and a second spike-bridge build into the kept
    directory failing at `SETUP_WORKINGDIR`; recorded under
    `## Verification results`.
- [x] Which of the previous build's state the second build reuses —
  `node_modules`, `ios/Pods`, the prebuilt `ios/` project, DerivedData — and
  whether files deleted from the project between builds persist in the working
  directory.
  - **Evidence:** none is reused and nothing persists, because the second build
    stops before touching the directory (`dist/workingdir.js:15-16`); recorded
    under `## Verification results`.
- [ ] What state a build that fails, and a build that is killed, leave behind,
  and whether the next build in that directory succeeds.
- [x] The eas-cli version the spike ran and the working directory's layout and
  size after one build are recorded under `## Verification results`.
  - **Evidence:** eas-cli 25.3.0 with `eas-cli-local-build-plugin@25.3.0`, and
    the layout table under `## Verification results` (4.5 GB, 102 s cold build).

### Task 2: Spike DerivedData and Ccache

**Files:** none — the scratch app, on a Mac

- [ ] Where a local build's DerivedData lands, and whether a second build in the
  same working directory reuses it.
- [ ] Whether DerivedData can be placed inside the working directory without
  changing any workspace file, when it does not land there already.
- [ ] Whether Ccache can stay on for a local build without changing any
  workspace file, with its cache directory inside the working directory.
- [ ] The results are recorded under `## Verification results`.

### Task 3: Spike build timings for each candidate

**Files:** none — the scratch app, on a Mac

- [ ] For the current fresh-directory build, a kept working directory, and a
  kept working directory with each reuse from Task 2 that works, the time of a
  cold build, a no-change rebuild, a JS-only change, and a native change (adding
  a native module) is recorded under `## Verification results` as one table.

### Task 4: Spike stale caches and the clean-build signals

**Files:** none — the scratch app, on a Mac

- [ ] What a build in a reused directory does after a pod is removed, after the
  profile is switched, after the Expo SDK is upgraded, after the eas-cli version
  changes, and after Xcode is upgraded: fails, builds wrong output, or builds
  correctly.
- [ ] For each case that does not build correctly, which value — readable
  without running project code — tells the host to build clean, is recorded
  under `## Verification results`.

### Task 5: Settle the design from the spike

**Files:** Modify: this plan, through `/agentdev:iwe-plan` revise mode

- [ ] When Tasks 1–3 show no way to make a repeat build meaningfully faster
  through a kept working directory, this plan is cancelled with that recorded as
  the decision.
- [ ] Otherwise the plan records the cache layout, the env vars `build` sets,
  the recorded inputs and the file each is read from, the cap's value, and
  whether a failed build's cache is reused. Tasks 6–14 and `## Spec changes` are
  updated to match. Any file the host newly reads follows the bridge's rules for
  `eas.json` and `app.json`: JSON or fixed-format parsing only, refusing a
  symlink, a non-regular file, or a file over a size limit.

### Task 6: Protocol version 2 and `eas-host build --clean`

**Files:** Modify: `packages/protocol/src/index.ts`,
`packages/workspace/src/cli-args.ts`, their tests, in
`plume-works/vscode-expo-bridge`

- [ ] `PROTOCOL_VERSION` is 2. `BuildRequest` takes an optional
  `clean: boolean`. `BuildResult` carries `mode: "incremental" | "clean"` and,
  when `mode` is `clean`, `cleanReason`. `StatusResult` carries `buildCache`
  with this workspace's cache size in bytes, and 0 when there is none.
- [ ] `eas-host build <profile> --clean` sends `clean: true`; any other extra
  argument is a usage error; `USAGE` names the flag.
- [ ] `bun test` covers the flag, a rejected unknown flag, and the version
  mismatch path at version 2.

### Task 7: Host — the per-workspace build cache

**Files:** Create: `packages/host/src/buildcache.ts` and its test, in
`plume-works/vscode-expo-bridge`

- [ ] A cache directory is derived from the host path's SHA-256, never from a
  name the container sends, and holds the working directory and a metadata file
  with the host path, the recorded inputs, the last build time, and whether the
  last build finished.
- [ ] Given a request and the current inputs, the module decides `incremental`
  or `clean` and the `cleanReason`, and a clean decision wipes the working
  directory before the build.
- [ ] A per-workspace lock lets one build hold a cache at a time.
- [ ] `bun test` covers each `cleanReason`, the incremental case, the lock, and
  that two host paths never share a directory.

### Task 8: Host — `build` runs in the cache

**Files:** Modify: `packages/host/src/build.ts`,
`packages/host/src/dispatch.ts`, `packages/host/src/trust.ts`,
`packages/host/src/extension.ts`, their tests, in
`plume-works/vscode-expo-bridge`

- [ ] `build` sets `EAS_LOCAL_BUILD_WORKINGDIR` to the cache's working directory
  and `EAS_LOCAL_BUILD_SKIP_CLEANUP=1`, plus any reuse settings Task 5 records.
  It records the build's inputs and whether it finished, and returns `mode` and
  `cleanReason`. The artifact directory, the log, and the copy into
  `.tmp/expo-bridge/` are unchanged.
- [ ] The build confirmation names a clean build when `clean` is set; a cooldown
  covers clean builds as it covers any build.
- [ ] A second build for a workspace whose build is running fails with
  `action-failed` and the message "a build is already running for this
  workspace".
- [ ] `bun test` covers the env, the returned mode, the clean confirmation text,
  the gating order with `clean`, and the concurrent-build refusal.

### Task 9: Host — cache size and the LRU cap

**Files:** Modify: `packages/host/src/buildcache.ts`,
`packages/host/src/status.ts`, their tests, in `plume-works/vscode-expo-bridge`

- [ ] `status` reports this workspace's cache size.
- [ ] Before a build, other workspaces' caches are evicted least recently built
  first until the total is under the cap; the building workspace's cache and a
  cache whose build is running are never evicted.
- [ ] `bun test` covers the size, the eviction order, and both exemptions.

### Task 10: Host — Clean Build Cache command and trust revocation

**Files:** Modify: `packages/host/src/extension.ts`,
`packages/host/src/trust.ts`, `packages/host/package.json`, their tests, in
`plume-works/vscode-expo-bridge`

- [ ] "Expo Bridge: Clean Build Cache" (`expoBridge.cleanBuildCache`) lists each
  cache's host path and size, and deletes the picked one after a modal. It takes
  no arguments, returns nothing, and refuses a cache whose build is running.
- [ ] Revoking a workspace's trust decision through the manage-trust command
  deletes that workspace's cache.
- [ ] `bun test` covers the delete after the modal, nothing deleted on dismiss,
  the running-build refusal, and deletion on revoke.

### Task 11: Document the cache in the sibling repository

**Files:** Modify: `docs/protocol.md`, `packages/host/README.md`, in
`plume-works/vscode-expo-bridge`

- [ ] `docs/protocol.md` specifies `--clean`, `mode` and `cleanReason`,
  `buildCache` in `status`, protocol version 2, the per-workspace cache in
  private global storage, the clean-build inputs, eviction, and that revoking
  trust deletes the cache.
- [ ] The host README names the Clean Build Cache command and the cache's cap.

### Task 12: Sibling repository CI passes

**Files:** none

- [ ] The sibling repository's CI passes on the commit that completes Tasks
  6–11.

### Task 13: Mac test from the packaged VSIX files

**Files:** none — the scratch app, on a Mac, with the packaged extensions
sideloaded

- [ ] A first build reports `clean` with `cleanReason: "no-cache"`; a repeat
  no-change build reports `incremental` and finishes faster than Task 3's
  fresh-directory baseline; a native change builds `incremental` and the app
  launches with the new module.
- [ ] `--clean` asks for confirmation naming a clean build and reports `clean`
  with `cleanReason: "requested"`.
- [ ] The Clean Build Cache command and a trust revocation each leave no cache
  directory for that workspace, and `status` then reports a size of 0.
- [ ] The timings are recorded under `## Verification results`.

### Task 14: Record the cache in this repository's project memory

**Files:** Modify: `docs/knowledge/data/features/vscode-expo-bridge.md`,
`docs/knowledge/data/architecture/vscode-expo-bridge.md`

- [ ] The feature's `## Behaviour` describes incremental builds and the two ways
  to get a clean one, and the architecture document describes the per-workspace
  cache and its place in the security model.

## Spec changes

None in `data/spec/` — this repository's spec covers only the template wiring,
which this plan leaves unchanged. The protocol contract lives in
`plume-works/vscode-expo-bridge` `docs/protocol.md` (Task 11). Its intended
post-change behavior, which Task 5 may refine and Task 13 verifies:

``` markdown
## ADDED Requirements

### Requirement: a repeat build reuses the workspace's build cache

The host SHALL build each workspace in a cache directory private to the host
extension and derived from the workspace's host path, SHALL keep that cache
between builds, and SHALL report each build's `mode` as `incremental` when it
reused the cache and `clean` otherwise, with a `cleanReason` for a clean build.
No build SHALL read another workspace's cache.

#### Scenario: a repeat build is incremental

- **WHEN** a trusted, confirmed build runs for a workspace whose cache exists,
  whose last build finished, and whose recorded inputs are unchanged
- **THEN** the result reports `mode: "incremental"`

#### Scenario: a first build is clean

- **WHEN** a build runs for a workspace with no cache
- **THEN** the result reports `mode: "clean"` and `cleanReason: "no-cache"`

#### Scenario: a changed input forces a clean build

- **WHEN** a recorded input differs from the cache's metadata, or the last
  build in the cache did not finish
- **THEN** the host wipes the cache before the build
- **AND** the result reports `mode: "clean"` with the reason

#### Scenario: two workspaces never share state

- **WHEN** two workspaces with different host paths build
- **THEN** each builds in its own cache directory

### Requirement: a clean build is available from the container and the Mac

`eas-host build <profile> --clean` SHALL send `clean: true`, and the host SHALL
wipe the workspace's cache before that build. A clean build SHALL go through
the same trust check and per-build confirmation as any build, and the
confirmation SHALL name it a clean build. The Mac-side Clean Build Cache command
SHALL take no arguments, return nothing, and delete a workspace's cache only
after the user confirms a modal.

#### Scenario: an agent asks for a clean build

- **WHEN** `eas-host build <profile> --clean` runs for a trusted workspace
- **THEN** the confirmation names a clean build
- **AND** a confirmed build reports `mode: "clean"` and
  `cleanReason: "requested"`

#### Scenario: the user cleans the cache on the Mac

- **WHEN** the user picks a workspace in Clean Build Cache and confirms
- **THEN** its cache directory no longer exists
- **AND** a dismissed modal deletes nothing

### Requirement: the build cache's disk use is visible and capped

`status` SHALL report the workspace's cache size. Before a build the host SHALL
evict other workspaces' caches, least recently built first, until the total is
under a fixed cap, never evicting the building workspace's cache or one whose
build is running. Revoking a workspace's trust decision SHALL delete its cache.

#### Scenario: the cap evicts the oldest cache

- **WHEN** a build starts while the total cache size is over the cap
- **THEN** the least recently built other workspace's cache is deleted first

#### Scenario: revoking trust removes the cache

- **WHEN** the user revokes a workspace's trust decision
- **THEN** that workspace's cache directory no longer exists

## MODIFIED Requirements

### Requirement: the protocol version

The protocol version SHALL be 2, and `eas-host status` SHALL exit 3 and name
both versions when the host reports another version.

#### Scenario: an older host

- **WHEN** `eas-host` at version 2 talks to a host at version 1
- **THEN** `eas-host status` exits 3 and names both versions
```

## Depends on

- [Build iOS on the Mac host through a VS Code
  bridge](20261015-vscode-expo-bridge.md) — this work changes that plan's
  `build` action and ships through the release sequence it defines.

## Verification

- Every Task 1–4 spike check is ticked and Task 5 has revised or cancelled the
  plan.
- In `plume-works/vscode-expo-bridge`, `bun test` passes, and the sibling CI
  passes (Task 12).
- Task 13's Mac run behaves as described, with its timings recorded.
- `iwe normalize` and `iwe schema validate` pass.

## Out of scope

- Device and store builds, Android, and EAS cloud build caching.
- Skipping a build by `@expo/fingerprint` match.
- Separating the Mac-wide bun and CocoaPods download caches per workspace.
- Publishing: the change reaches the Marketplace and Open VSX through the bridge
  plan's release sequence.

## Key references

Verified anchor points (line numbers as of 2026-10-23):

In `plume-works/vscode-expo-bridge` at `a6c6574`:

- `packages/protocol/src/index.ts:6` — `PROTOCOL_VERSION`
- `packages/protocol/src/index.ts:24` — `BuildRequest`
- `packages/protocol/src/index.ts:57` — `StatusResult`
- `packages/protocol/src/index.ts:78` — `BuildResult`
- `packages/workspace/src/cli-args.ts:21` — `USAGE`
- `packages/workspace/src/cli-args.ts:35` — `parseArgs` `build` case
- `packages/host/src/build.ts:44` — `build`
- `packages/host/src/build.ts:77` — the build's env with
  `EAS_LOCAL_BUILD_ARTIFACTS_DIR`
- `packages/host/src/dispatch.ts:56` — the `build` gate in `dispatch`
- `packages/host/src/trust.ts:61` — `TrustStore.revoke`
- `packages/host/src/trust.ts:91` — `TrustStore.confirmBuild`
- `packages/host/src/extension.ts:104` — `buildDispatchDeps`
- `packages/host/src/extension.ts:143` — `buildDeps`
- `packages/host/src/extension.ts:216` — `expoBridge.manageTrust`
- `packages/host/src/status.ts:46` — `status`
- `packages/host/package.json:26` — `contributes.commands`
- `docs/protocol.md:100` — the protocol version in `status`
- `docs/protocol.md:102` — `### build`
- `docs/protocol.md:196` — `## eas-host`

In `plume-works/agent-expo-bridge-spikes` at `3409e51`:

- `extensions/ui/extension.js:131` — the `keepWorkdir` build option setting
  `EAS_LOCAL_BUILD_WORKINGDIR` and `EAS_LOCAL_BUILD_SKIP_CLEANUP`
- `extensions/ui/spikes.js:364` — `task10_reuse`

## Verification results

### Task 1: eas-cli refuses an existing working directory

eas-cli 25.3.0 runs a local build through `eas-cli-local-build-plugin@25.3.0`.
Its `prepareWorkingdirAsync` (`dist/workingdir.js:15-16`) throws
`Workingdir is not empty.` when `EAS_LOCAL_BUILD_WORKINGDIR` names a directory
that exists and has any entry. A second build of the unchanged scratch app into
the directory the first build kept failed at `SETUP_WORKINGDIR` and changed
nothing in it. No state from a previous build is reused, and no build in a
directory a previous build left — finished or failed — succeeds. The plugin
removes the directory in an exit handler unless `EAS_LOCAL_BUILD_SKIP_CLEANUP`
is set.

The working directory after one successful simulator build of the scratch app
(Expo SDK 58, React Native 0.88, prebuilt React Native core) is 4.5 GB, and the
cold build took 102 s:

| Path in the working directory                                            | Contents                                          | Size   |
| ------------------------------------------------------------------------ | ------------------------------------------------- | ------ |
| `build/`                                                                 | the extracted project, after prebuild             | 4.4 GB |
| `build/ios/build/`                                                       | DerivedData (Gymfile `derived_data_path ./build`) | 2.5 GB |
| `build/ios/Pods/`                                                        | installed pods                                    | 1.5 GB |
| `build/node_modules/`                                                    | installed packages                                | 563 MB |
| `artifacts.tar.gz`, `logs/`, `project.tar.gz`                            | the artifact, logs, the project archive           | 44 MB  |
| `artifacts/`, `bin/`, `custom-build/`, `env/`, `temporary-custom-build/` | empty or near-empty                               | —      |
