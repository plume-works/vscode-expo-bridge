---
type: plan
created: 2026-10-23
release:
- features/vscode-expo-bridge
description: Make `eas-host build` of an Expo iOS development build reuse the workspace's earlier artifact when a cache key — the project's @expo/fingerprint, computed inside the confirmed build, plus the inputs the fingerprint leaves out — matches, with `eas-host build <profile> --clean` for a full build, the outcome reported in the result, a cache per workspace folder, and protocol version 2 kept.
generated:
  by: claude-code/opus-5.5
  at: 2026-10-25T03:09:30Z
sources:
- resource: docs/knowledge/data/plans/20261023-expo-bridge-incremental-builds.md
- resource: docs/knowledge/data/plans/20261015-vscode-expo-bridge.md
- resource: docs/knowledge/data/plans/20261023-expo-bridge-workspace-folders.md
- resource: https://github.com/plume-works/vscode-expo-bridge
- resource: https://docs.expo.dev/versions/latest/sdk/fingerprint/
- resource: https://www.npmjs.com/package/eas-cli/v/25.3.0
- resource: https://www.npmjs.com/package/@expo/build-tools/v/25.3.0
stage: done
completed: 2026-10-25
---

# Reuse a matching Expo bridge build by fingerprint

## Context

The [VS Code Expo bridge](../features/vscode-expo-bridge.md) runs every
`eas-host build` as a full `eas build --local`: a cold simulator build of the
scratch app (Expo SDK 58, React Native 0.88, prebuilt React Native core) took
102 s ([incremental builds plan](20261023-expo-bridge-incremental-builds.md)
`## Verification results`). eas-cli 25.3.0 runs a local build through
`eas-cli-local-build-plugin@25.3.0`, which refuses a non-empty working
directory, so no build state carries over between local builds ([incremental
builds plan](20261023-expo-bridge-incremental-builds.md), cancelled). That
leaves the whole-build case: when nothing native changed, the earlier artifact
is still the right artifact.

This plan builds on [the bridge acting on the agent's window and workspace
folder](20261023-expo-bridge-workspace-folders.md): there, every request names a
workspace folder, the host maps it to a Mac path under the window's host path,
and every action runs at that folder's Mac path, on protocol version 2. Here,
"the project" is that folder's Mac path, and trust stays keyed to the host path.

A development build loads its JavaScript from Metro, so its `.app` depends only
on native inputs. Expo uses the same rule: `eas build:dev` reuses a cloud
development build whose fingerprint matches, and the `expo run` local build
cache keys on platform, fingerprint, and build configuration.

Settled facts this plan builds on:

- **eas-cli already runs the fingerprint inside every build.** `eas build`
  evaluates the app config and calls `createFingerprintAsync`, loading
  `expo/fingerprint` from the workspace's own `node_modules` (`eas-cli@25.3.0`
  `build/fingerprint/cli.js:23`, `build/build.js:656`). A local build does not
  upload it (`project/maybeUploadFingerprintAsync.js`), and nothing in
  `@expo/build-tools@25.3.0` or the local build plugin reads `fingerprintHash`.
- **eas's own hash is not recoverable.** It is printed only in the failure
  context (`build/local.js:116`); the plugin logs `job` but not `metadata`.
  `eas fingerprint:generate` uploads the fingerprint and creates a Fingerprint
  record on the EAS project (`fingerprint/utils.js:27-35`).
- **What the default `balanced` fingerprint covers** (`@expo/fingerprint`
  0.21.5, Expo SDK 58): a JavaScript edit, `version`, `eas.json` (including a
  switch to `developmentClient: false`), and `bun.lock` leave the hash
  unchanged; the app `name` and an installed native module change it. A native
  module declared in `package.json` but not installed in `node_modules` leaves
  it unchanged, and with no `node_modules` `expo/fingerprint` does not resolve.
- **A development build's artifact embeds no JavaScript.** A `developmentClient`
  build loads its JavaScript from Metro and its artifact holds no
  `main.jsbundle`; a Release build embeds one. The store check (Task 5) enforces
  this rather than relying on it.

## Approach

**The fingerprint is a build step.** After trust and the per-build confirmation,
`build` runs a host-owned script with the Mac's `node`, in the folder's Mac
path, that loads the project's `expo/fingerprint` and prints
`createFingerprintAsync(<folder's Mac path>, { platforms: ["ios"] })`'s hash. It
runs no code `eas build` would not already run at the same point of the same
confirmed build, so "outside `build`, the host never evaluates project code"
still holds; the step never runs in `status` or before the confirmation. A
missing node, an unresolvable `expo/fingerprint`, a failure, or output that is
not one 40-digit hex hash means no fingerprint, and the build runs in full.

**The cache key** is the SHA-256 of the fingerprint hash together with the
inputs the fingerprint leaves out: the profile name, the bytes of `eas.json`,
`package.json`, and each lockfile present (`bun.lock`, `bun.lockb`,
`package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`), the eas-cli version that
`bunx eas-cli@<spec> --version` resolves, `xcodebuild -version`, and the host
extension's version, all read from the folder's Mac path. The files are read as
bytes under the bridge's file rules — a symlink, a non-regular file, or a file
over the size limit means no key, and the build runs in full.

**The cache** lives in the host's private global storage under
`build-cache/<sha256 of the host path>/<sha256 of the folder's Mac path>/`: an
`index.json` and one artifact per key, newest five kept per folder, so two Expo
apps under one host path never share entries. The container sends `profile`,
`clean`, and the `folder` the host maps; it never names a cache directory or a
key. A build stores its artifact only when it exited 0, produced an artifact,
and that artifact contains no `main.jsbundle` — so a build that embeds
JavaScript is never reused. A hit copies the stored artifact into the folder's
`.tmp/expo-bridge/` under the fresh-write rule with a new name, so
`eas-host install` with no path picks it. Every build, reused or not, writes its
log file. Writes go through a temporary file and a rename, so no reader sees a
partial entry. Revoking a host path's trust decision deletes the cache of every
folder under it.

**One index update at a time per folder.** Updates to a folder's `index.json`
are serialized by an `index.lock` file in that folder's cache directory, created
with `O_CREAT | O_EXCL` and holding its owner's process id. Builds in one folder
can run concurrently from one VS Code window or several, and each window's host
extension is its own process, so a lock held in memory would not cover them. The
copy of the artifact into the cache and the read, update, eviction, and write of
`index.json` hold the lock, never the build; with the copy inside, a build that
times out waiting leaves no orphaned artifact. A lock whose owner process no
longer exists, or that is older than a fixed limit, is taken over; when the lock
cannot be taken within a fixed wait, the build stores nothing and its log says
so.

**The protocol stays at version 2**, the version the workspace-folder plan sets.
`BuildRequest` gains an optional `clean`, and `BuildResult` gains `mode`
(`built` or `reused`), `reason` for a full build (`clean-requested`,
`no-fingerprint`, `no-match`), and `reusedBuiltAt` for a reused one. A host
without this change ignores `clean` and always builds in full, which is what
`--clean` asks for; an `eas-host` without it ignores the new result fields.
`eas-host status` compares versions for equality, and the two extensions update
independently, so a version bump would break every mixed pairing for no gain.

**A clean build.** `eas-host build <profile> --clean` sends `clean: true`; the
host skips the lookup, builds in full, and computes the key after the build to
store the result. The build confirmation names a clean build when `clean` is set
and otherwise says a matching earlier build may be reused.

The fingerprint is a correctness hint, not a security input. Project code
(`app.config.js`, `fingerprint.config.js`) can force a match; the worst outcome
is a stale artifact this same workspace's confirmed build produced, which the
container could already reach by writing any `.app` under `.tmp/expo-bridge/`
and installing it.

Rejected: reading eas's own fingerprint through an `EAS_LOCAL_BUILD_PLUGIN_PATH`
shim that decodes `EAS_LOCAL_BUILD_PLUGIN_INPUT` — it depends on an internal
handoff that carries credentials, re-implements the plugin's launch, and still
pays eas-cli's start-up on a hit. Rejected: `eas fingerprint:generate` — it
writes a Fingerprint record to the EAS project on every build. Rejected:
re-bundling JavaScript into a stored Release artifact — it re-implements Xcode's
bundle phase and re-signing. Rejected: protocol version 3, for the mixed
pairings above. Rejected: an in-process mutex for the index — it does not cover
a second VS Code window's host extension.

Assumptions:

- Five stored artifacts per workspace folder, a constant in the host extension;
  at about 45 MB per simulator artifact a folder's cache stays near 225 MB, so
  no cross-folder cap.
- The fingerprint uses `@expo/fingerprint`'s defaults with `platforms: ["ios"]`
  and no `ignorePaths`, so a generated `ios/` directory counts as native input.
  The key needs only to agree with itself, not with eas's own hash.
- The file size limit for hashing is 64 MB, a constant; `eas.json` keeps its
  existing JSON limit for parsing.
- The index lock waits up to 10 s, retrying every 50 ms, and a lock older than
  60 s is stale; both are constants in the host extension. The locked section
  copies one simulator artifact, about 45 MB, and rewrites a small JSON file,
  far shorter than either bound, so neither is reached while its owner is alive.

## Implementation Steps

### Task 1: Protocol fields for reuse

**Files:** Modify: `packages/protocol/src/index.ts`, its test, in
`plume-works/vscode-expo-bridge`

- [x] `BuildRequest` takes an optional `clean: boolean`. `BuildResult` carries
  optional `mode: "built" | "reused"`, `reason` (`"clean-requested"`,
  `"no-fingerprint"`, `"no-match"`) when `mode` is `built`, and `reusedBuiltAt`
  (epoch milliseconds) when `mode` is `reused`. `PROTOCOL_VERSION` stays 2.
  - **Evidence:** plume-works/vscode-expo-bridge `69ca507` on branch
    `fingerprint-reuse` (`packages/protocol/src/index.ts`: `clean`, `BuildMode`,
    `BuildReason`, `reusedBuiltAt`); `bun run typecheck` passes.
- [x] `bun test` covers the new fields' types and that the version is 2.
  - **Evidence:** `69ca507` `packages/protocol/test/index.test.ts` "build reuse
    fields" (with a `@ts-expect-error` for an unknown mode under
    `bun run typecheck`) and "is version 2"; `bun test packages/protocol` 6
    pass, 0 fail.

### Task 2: `eas-host build <profile> --clean`

**Files:** Modify: `packages/workspace/src/cli-args.ts`, its test, in
`plume-works/vscode-expo-bridge`

- [x] `eas-host build <profile> --clean` sends `clean: true`; any other argument
  after the profile is a usage error. `USAGE` names the flag, and `HELP` says a
  build reuses an earlier artifact when the native inputs are unchanged and that
  `--clean` forces a full build.
  - **Evidence:** plume-works/vscode-expo-bridge `f591bf8`
    (`packages/workspace/src/cli-args.ts` `parseArgs` `build` case, `USAGE`,
    `HELP`); `bun run typecheck` passes.
- [x] `bun test` covers the flag, its absence, and a rejected unknown argument.
  - **Evidence:** `f591bf8` `packages/workspace/test/cli-args.test.ts` "build
    --clean asks for a clean build", "build rejects any other argument after the
    profile", and the HELP assertions; `bun test packages/workspace` 52 pass, 0
    fail.

### Task 3: Host — the fingerprint step

**Files:** Create: `packages/host/src/fingerprint.ts` and its test, in
`plume-works/vscode-expo-bridge`

- [x] `projectFingerprint` runs the Mac's `node` (`lookupTool`) on a script held
  as a constant in the module, with the folder's Mac path as its argument and as
  the working directory, through the runner's argument array. The script
  resolves `expo/fingerprint` from that path and prints the hash of
  `createFingerprintAsync(<that path>, { platforms: ["ios"] })`.
  - **Evidence:** plume-works/vscode-expo-bridge `af84206`
    `packages/host/src/fingerprint.ts` (`FINGERPRINT_SCRIPT`, run as `node -e`);
    the script printed a 40-digit hash against the scratch Expo SDK 58 app's own
    `expo/fingerprint`.
- [x] It returns the hash only when the output is one 40-digit lowercase hex
  string and the process exited 0; it returns null for a missing node, a
  non-zero exit, or any other output, and never includes the output in an error.
  - **Evidence:** `af84206` `projectFingerprint` returns null on no node, a
    non-zero exit, or a non-hash stdout and throws nothing; covered by
    `packages/host/test/fingerprint.test.ts`.
- [x] `bun test` covers a hash, each null case, and the argument array.
  - **Evidence:** `af84206` `packages/host/test/fingerprint.test.ts`;
    `bun test packages/host/test/fingerprint.test.ts` 5 pass, 0 fail.

### Task 4: Host — the cache key

**Files:** Create: `packages/host/src/buildkey.ts` and its test, in
`plume-works/vscode-expo-bridge`

- [x] `buildKey` returns the SHA-256 over the fingerprint hash, the profile, the
  SHA-256 of `eas.json`, `package.json`, and each present lockfile (`bun.lock`,
  `bun.lockb`, `package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`), the resolved
  eas-cli version, `xcodebuild -version`, and the host extension's version, each
  named in the hashed record.
  - **Evidence:** plume-works/vscode-expo-bridge `b6c806e`
    `packages/host/src/buildkey.ts` `buildKey`, hashing a JSON record keyed by
    input name.
- [x] Each file is read as bytes from the folder's Mac path and refused when any
  path component is a symlink, the file is not regular, or it is over 64 MB; a
  refusal, a missing `package.json`, or a failed version probe returns null.
  - **Evidence:** `b6c806e` `hashFile` (`rejectSymlinksBelow`, `O_NOFOLLOW`,
    `fstat` regular-file and `MAX_HASHED_BYTES` checks) and the null returns in
    `buildKey`.
- [x] `bun test` covers a change in each input changing the key, an absent
  lockfile, and each refusal.
  - **Evidence:** `b6c806e` `packages/host/test/buildkey.test.ts`;
    `bun test packages/host/test/buildkey.test.ts` 9 pass, 0 fail.

### Task 5: Host — the per-folder build cache

**Files:** Create: `packages/host/src/buildcache.ts` and its test, in
`plume-works/vscode-expo-bridge`

- [x] The cache directory is
  `<globalStorage>/build-cache/<sha256 of the host path>/<sha256 of the folder's Mac path>/`,
  from the host path and the mapped folder, never from a path the container
  sends. `index.json` records both paths and, per key, the artifact file and the
  time it was built.
  - **Evidence:** plume-works/vscode-expo-bridge `d5533c1`
    `packages/host/src/buildcache.ts` `folderCacheDir` and `CacheIndex`; the
    `BuildCache` constructor takes the host path and the mapped folder only.
- [x] `lookup(key)` returns the stored artifact and its build time, or null.
  `store(key, artifact, builtAt)` refuses an archive that contains a
  `main.jsbundle`, writes through a temporary file and a rename, and keeps the
  five newest entries, deleting the rest. `remove(hostPath)` deletes the host
  path's directory with every folder under it.
  - **Evidence:** `d5533c1` `BuildCache.lookup`, `BuildCache.store` (`tar -tzf`
    listing, `writeAtomic`, `MAX_ENTRIES` = 5), and `remove`.
- [x] `bun test` covers a hit, a miss, the refused archive, the eviction order,
  removal, and that two host paths, or two folders under one host path, never
  share a directory.
  - **Evidence:** `d5533c1` `packages/host/test/buildcache.test.ts`, with real
    gzipped tar archives; `bun test packages/host/test/buildcache.test.ts` 8
    pass, 0 fail.

### Task 6: Host — `build` reuses or stores

**Files:** Modify: `packages/host/src/build.ts`,
`packages/host/src/dispatch.ts`, `packages/host/src/extension.ts`, their tests,
in `plume-works/vscode-expo-bridge`

- [x] Without `clean`, `build` computes the fingerprint and the key after its
  existing profile and eas-cli checks. On a hit it copies the stored artifact
  into the folder's `.tmp/expo-bridge/build-<ms>.tar.gz` under the fresh-write
  rule, writes the log, and returns `mode: "reused"` with `reusedBuiltAt` and
  `exitCode` 0, without running eas-cli.
  - **Evidence:** plume-works/vscode-expo-bridge `0b5e10a`
    `packages/host/src/build.ts` `build` (lookup and `copyFresh` to
    `build-<ms>.tar.gz`); `packages/host/test/build.test.ts` "a first build is
    built with no-match and stored; a repeat build is reused" asserts one
    eas-cli run.
- [x] On a miss, with no key, or with `clean`, it runs the existing
  `eas build --local` and returns `mode: "built"` with the reason
  (`no-fingerprint` also covers a fingerprint with no key); a build that exited
  0 with an artifact is offered to `store` under its key (a clean build computes
  the key after the build).
  - **Evidence:** `0b5e10a` `build` and `dispatch` passing
    `clean: req.clean === true`; `extension.ts` `buildDeps` supplies the host
    path and `packageJSON.version`; build tests "a changed input builds in full
    with no-match", "no fingerprint …", "a fingerprint without a key is also
    no-fingerprint", "clean skips the lookup …".
- [x] The log names the fingerprint hash, the key, and the outcome, and never a
  file's contents.
  - **Evidence:** `0b5e10a` `build`'s `expo-bridge:` log lines; build tests
    assert the fingerprint, key, and reuse lines and "the log names no file's
    contents".
- [x] `bun test` covers the hit, each `reason`, the store after success, no
  store after a failed build, and that the fingerprint step runs only for a
  confirmed build.
  - **Evidence:** `0b5e10a` `packages/host/test/build.test.ts` `reuse` (10
    tests, including "a failed build is not stored" and "an unconfirmed build
    runs no fingerprint step") and `dispatch.test.ts` clean routing; `bun test`
    300 pass, 0 fail.

### Task 7: Host — confirmation text and trust revocation

**Files:** Modify: `packages/host/src/trust.ts`,
`packages/host/src/extension.ts`, their tests, in
`plume-works/vscode-expo-bridge`

- [x] The build confirmation names a clean build when `clean` is set, and
  otherwise says a matching earlier build may be reused; a cooldown covers both.
  - **Evidence:** plume-works/vscode-expo-bridge `2a18b6d`
    `packages/host/src/trust.ts` `buildConfirmationText` and `confirmBuild`'s
    `clean`, which `dispatch` passes and the cooldown check precedes.
- [x] Revoking a host path's trust decision through the manage-trust command
  deletes the build cache of every folder under it.
  - **Evidence:** `2a18b6d` `TrustStore`'s `onRevoke`, wired in `extension.ts`
    `activate` to `buildcache.remove`; the manage-trust modal says the cache is
    deleted.
- [x] `bun test` covers both confirmation texts and the deletion on revoke.
  - **Evidence:** `2a18b6d` `packages/host/test/trust.test.ts` "a clean build"
    and "revoking trust" (a real cache directory removed) and `dispatch.test.ts`
    "the build confirmation learns whether the build is clean"; `bun test` 306
    pass, 0 fail.

### Task 8: Document reuse in the sibling repository

**Files:** Modify: `docs/protocol.md`, `packages/host/README.md`, in
`plume-works/vscode-expo-bridge`

- [x] `docs/protocol.md` specifies `clean`, `mode`, `reason`, `reusedBuiltAt`,
  the fingerprint step as part of `build`, the cache key's inputs, the
  per-folder cache and its five-entry limit, that only artifacts without an
  embedded bundle are stored, that revoking trust deletes the cache, and that
  the protocol version stays 2.
  - **Evidence:** plume-works/vscode-expo-bridge `2d8db83` `docs/protocol.md`
    "Reuse of a matching development build" under `### build`, the actions
    table, the security model's confirmation, trust, and fingerprint-step
    bullets, and `## eas-host`; `bun run lint` passes.
- [x] The host README states that a development build is reused when its native
  inputs match and that `--clean` forces a full build.
  - **Evidence:** `2d8db83` `packages/host/README.md`.

### Task 9: Sibling repository CI passes

**Files:** none

- [x] The sibling repository's CI passes on the commit that completes Tasks 1–8.
  - **Evidence:** plume-works/vscode-expo-bridge PR #22, CI run 40063682902
    `build` passed on `2d8db83` (lint, typecheck, `bun test`, three VSIX
    packaged).

### Task 10: Mac timing of the fingerprint step and a reused build

**Files:** none — the scratch app, on a Mac, as a workspace folder of a Dev
Containers window on a repository that contains it, with the packaged extensions
sideloaded

- [x] The fingerprint step's time and a reused build's total time, from request
  to result, are recorded under `## Verification results`, with the cold build
  time on the same Mac.
  - **Evidence:** `## Verification results` Task 10: cold `--clean` build 111.0
    s, reused build 0.68–0.72 s over three runs, which bounds the fingerprint
    step.
- [x] When a reused build takes 15 s or more, the plan goes back to
  `/agentdev:iwe-plan` revise mode with the measurement before Task 11.
  - **Evidence:** not triggered: a reused build took at most 0.72 s
    (`## Verification results` Task 10).

### Task 11: Mac round trip from the packaged VSIX files

**Files:** none — the scratch app, on a Mac, as in Task 10

- [x] A first build reports `mode: "built"`, `reason: "no-match"`; a repeat
  build reports `mode: "reused"`; `eas-host install` with no path and
  `eas-host launch` run the reused artifact against Metro, and a screenshot
  shows the app.
  - **Evidence:** `## Verification results` Task 11, the `expo-haptics` row:
    `no-match`, then `reused`, installed with no path, launched against Metro,
    and screenshotted.
- [x] A JavaScript-only edit is reused and shows the edit through Metro; adding
  an installed native module reports `reason: "no-match"` and the app launches
  with it.
  - **Evidence:** `## Verification results` Task 11, the JavaScript-only edit
    and `expo-haptics` rows.
- [x] `--clean` asks for a confirmation naming a clean build and reports
  `reason: "clean-requested"`; a Release simulator profile builds in full twice
  in a row.
  - **Evidence:** `## Verification results` Task 11, the `--clean` and
    `release-sim` rows.
- [x] A second Expo app added as another workspace folder of the same window
  builds in full on its first build, without reusing the first app's entry.
  - **Evidence:** `## Verification results` Task 11, the `app2` row: the same
    key in the other folder did not hit.
- [x] Revoking the host path's trust leaves no cache directory for it.
  - **Evidence:** `## Verification results` Task 11, the trust revocation row.

### Task 12: Record reuse in this repository's project memory

**Files:** Modify: `docs/knowledge/data/features/vscode-expo-bridge.md`,
`docs/knowledge/data/architecture/vscode-expo-bridge.md`

- [x] The feature's `## Behaviour` describes the reuse of a matching development
  build and `--clean`, and the architecture document places the fingerprint step
  inside `build` in its security model and describes the per-folder cache.
  - **Evidence:** `data/features/vscode-expo-bridge.md` "A matching development
    build is reused." and `data/architecture/vscode-expo-bridge.md`
    `### Build reuse`, its security model sentence on the fingerprint step, a
    constraint, and two rejected alternatives; `iwe schema validate` passes.

### Task 13: Host — lock the folder's cache index

**Files:** Modify: `packages/host/src/buildcache.ts`, its test, in
`plume-works/vscode-expo-bridge`

- [x] `BuildCache.store` holds `index.lock` in the folder's cache directory,
  created with `O_CREAT | O_EXCL` and holding the process id, from copying the
  artifact through writing `index.json`, and removes the lock afterwards, also
  when the update throws.
  - **Evidence:** plume-works/vscode-expo-bridge `1e643f6`
    `packages/host/src/buildcache.ts` `withIndexLock`, which `store` wraps
    around the artifact copy and the `index.json` read, update, and write; its
    `finally` removes only its own lock (inode check).
- [x] A lock whose process id is not a live process, or whose age is over 60 s,
  is removed and taken; any other held lock is retried every 50 ms for up to 10
  s, after which `store` stores nothing and returns false.
  - **Evidence:** `1e643f6` `isStale`, `takeOver`, and the `LOCK_STALE_MS`,
    `LOCK_RETRY_MS`, `LOCK_WAIT_MS` constants; `store` returns false when
    `withIndexLock` returns null.
- [x] `bun test` covers two concurrent `store` calls for different keys in one
  folder — from two separate processes — keeping both entries, the takeover of a
  dead owner's and of an expired lock, the refusal after the wait, and the
  lock's removal after a failed update.
  - **Evidence:** `1e643f6` `packages/host/test/buildcache.test.ts` "the index
    lock" (5 tests; the two-process test runs `test/fixtures/store-child.ts`
    twice and fails with the lock bypassed); `bun test` 311 pass, 0 fail.

### Task 14: Document the index lock

**Files:** Modify: `docs/protocol.md` in `plume-works/vscode-expo-bridge`;
`docs/knowledge/data/architecture/vscode-expo-bridge.md`

- [x] `docs/protocol.md`'s reuse section states that updates to a folder's
  `index.json` are serialized by `index.lock` across processes, the stale-lock
  takeover, and that a build that cannot take the lock stores nothing.
  - **Evidence:** plume-works/vscode-expo-bridge `8b5a960` `docs/protocol.md`
    "Reuse of a matching development build", the store paragraph; `bun run lint`
    passes.
- [x] The architecture document's `### Build reuse` states the cross-process
  index lock and why an in-memory lock does not suffice.
  - **Evidence:** `data/architecture/vscode-expo-bridge.md` `### Build reuse`,
    the "Index updates are serialized across processes" bullet, in this commit;
    `iwe schema validate` passes.

### Task 15: Sibling repository CI passes on the index lock

**Files:** none

- [x] The sibling repository's CI passes on the commit that completes Tasks
  13–14.
  - **Evidence:** plume-works/vscode-expo-bridge PR #22, CI run 40150892687
    `build` passed on `8b5a960` (lint, typecheck, `bun test`, three VSIX
    packaged).

## Spec changes

None in `data/spec/` — this repository's spec covers only the template wiring,
which this plan leaves unchanged. The protocol contract lives in
`plume-works/vscode-expo-bridge` `docs/protocol.md` (Task 8). Its intended
post-change behavior, which Task 11 verifies:

``` markdown
## ADDED Requirements

### Requirement: a build reuses a matching earlier development build

Without `clean`, the host SHALL compute the cache key after trust and the build
confirmation, and SHALL return the request folder's stored artifact with
`mode: "reused"` when an entry for that key exists, without running eas-cli.
Otherwise it SHALL run the full build and report `mode: "built"` with a
`reason`. The host SHALL store an artifact only from a build that exited 0 and
whose artifact contains no embedded JavaScript bundle. Concurrent builds in one
folder SHALL NOT drop each other's stored entries, from one VS Code window or
several. No workspace folder SHALL read another folder's cache, under the same
host path or another.

#### Scenario: unchanged native inputs reuse the artifact

- **WHEN** a trusted, confirmed build runs and its cache key matches a stored
  entry
- **THEN** the result reports `mode: "reused"` and `reusedBuiltAt`
- **AND** the artifact is a fresh file under `.tmp/expo-bridge/`

#### Scenario: concurrent builds in one folder keep both entries

- **WHEN** two builds with different cache keys in the same folder store their
  artifacts at the same time, from the same or different host extension
  processes
- **THEN** a later build with either key reports `mode: "reused"`

#### Scenario: a changed input builds in full

- **WHEN** the fingerprint, the profile, `eas.json`, `package.json`, a lockfile,
  the eas-cli version, the Xcode version, or the host extension version differs
  from every stored entry
- **THEN** the result reports `mode: "built"` and `reason: "no-match"`

#### Scenario: no fingerprint builds in full

- **WHEN** the fingerprint step yields no hash
- **THEN** the result reports `mode: "built"` and `reason: "no-fingerprint"`

#### Scenario: a build with an embedded bundle is never reused

- **WHEN** a build's artifact contains `main.jsbundle`
- **THEN** the host stores nothing for it

#### Scenario: two workspaces never share a cache

- **WHEN** two workspaces with different host paths build
- **THEN** each reads and writes only its own cache directory

#### Scenario: two folders under one host path never share a cache

- **WHEN** two Expo apps that are workspace folders under the same host path
  build
- **THEN** each reads and writes only its own folder's cache directory

### Requirement: the fingerprint step is part of the confirmed build

The host SHALL evaluate the project's fingerprint only within a `build` that
passed trust and the per-build confirmation, and never in `status` or any
other action.

#### Scenario: a declined build computes nothing

- **WHEN** the user declines the build confirmation
- **THEN** the host runs no fingerprint step

### Requirement: a clean build is available from the container

`eas-host build <profile> --clean` SHALL send `clean: true`. The host SHALL then
skip the fingerprint lookup, run the full build, and report
`mode: "built"` with `reason: "clean-requested"`. A clean build SHALL go through
the same trust check and confirmation as any build, and the confirmation SHALL
name it a clean build.

#### Scenario: an agent asks for a clean build

- **WHEN** `eas-host build <profile> --clean` runs for a trusted workspace
- **THEN** the confirmation names a clean build
- **AND** a confirmed build reports `reason: "clean-requested"`

#### Scenario: an older host

- **WHEN** `eas-host build <profile> --clean` reaches a host without reuse
- **THEN** the host builds in full

### Requirement: revoking trust removes the build cache

Revoking a host path's trust decision SHALL delete the build cache of every
workspace folder under that host path.

#### Scenario: the user revokes trust

- **WHEN** the user revokes a host path's trust decision
- **THEN** no cache directory remains for any folder under it
```

## Depends on

- [Build iOS on the Mac host through a VS Code
  bridge](20261015-vscode-expo-bridge.md) — this work changes that plan's
  `build` action and ships through the release sequence it defines.
- [Expo bridge acts on the agent's window and workspace
  folder](20261023-expo-bridge-workspace-folders.md) — the folder's Mac path,
  the `folder` field, and protocol version 2 this plan builds on.

## Verification

- In `plume-works/vscode-expo-bridge`, `bun test` passes, and the sibling CI
  passes (Task 9, and Task 15 for the index lock).
- Task 13's two-process test keeps both entries; the lock needs no Mac run, as
  its behavior does not depend on macOS or Xcode.
- Task 10's timings are recorded, and a reused build takes under 15 s.
- Task 11's Mac run behaves as described.
- `iwe normalize` and `iwe schema validate` pass.

## Out of scope

- Reusing a Release or other embedded-bundle build, device and store builds, and
  Android.
- Inputs outside the key: EAS server-side environment variables, the Mac login
  environment, and the macOS and simulator runtime versions. `--clean` covers a
  change in any of them.
- A Mac-side command to delete a folder's cache; revoking trust does.
- Changing the template's Expo agent rule in the consumption guide.

## Key references

Verified anchor points (line numbers as of 2026-10-24):

In `plume-works/vscode-expo-bridge` at `6c654ea`:

- `packages/protocol/src/index.ts:6` — `PROTOCOL_VERSION`
- `packages/protocol/src/index.ts:52` — `BuildRequest`
- `packages/protocol/src/index.ts:109` — `BuildResult`
- `packages/workspace/src/cli-args.ts:21` — `USAGE`
- `packages/workspace/src/cli-args.ts:23` — `HELP`
- `packages/workspace/src/cli-args.ts:81` — `parseArgs` `build` case
- `packages/workspace/bin/eas-host.ts:95` — the protocol version equality check
- `packages/host/src/build.ts:45` — `build`
- `packages/host/src/build.ts:61` — `lookupTool("bun")`
- `packages/host/src/build.ts:65` — `easCliSpec`
- `packages/host/src/build.ts:72` — the private build directory
- `packages/host/src/build.ts:114` — `copyFresh` of the artifact into the
  workspace
- `packages/host/src/dispatch.ts:72` — the `build` gate in `dispatch`
- `packages/host/src/trust.ts:73` — `TrustStore.revoke`
- `packages/host/src/trust.ts:103` — `TrustStore.confirmBuild`
- `packages/host/src/extension.ts:33` — the build confirmation prompt
- `packages/host/src/extension.ts:183` — `buildDeps`
- `packages/host/src/extension.ts:266` — `expoBridge.manageTrust`
- `packages/host/src/env.ts:49` — `lookupTool`
- `packages/host/src/paths.ts:102` — `openFreshUnique`
- `packages/host/src/paths.ts:116` — `copyFresh`
- `packages/host/src/jsonfile.ts:4` — `MAX_JSON_BYTES`
- `packages/host/package.json:6` — the host extension's version
- `docs/protocol.md:154` — `### build`
- `docs/protocol.md:248` — `## eas-host`

In `plume-works/vscode-expo-bridge` at `8b5a960` (line numbers as of
2026-10-25):

- `packages/host/src/buildcache.ts:47` — `writeAtomic`
- `packages/host/src/buildcache.ts:99` — `withIndexLock`
- `packages/host/src/buildcache.ts:193` — `BuildCache.readIndex`
- `packages/host/src/buildcache.ts:206` — `BuildCache.writeIndex`
- `packages/host/src/buildcache.ts:225` — `BuildCache.store`
- `packages/host/src/buildcache.ts:235` — the locked copy and index update in
  `store`
- `packages/host/src/build.ts:171` — `build` offering its artifact to `store`

In `eas-cli@25.3.0`:

- `build/build.js:656` —
  `computeAndMaybeUploadFingerprintWithoutExpoUpdatesAsync`
- `build/fingerprint/cli.js:23` — `createFingerprintAsync` resolving
  `expo/fingerprint` from the project
- `build/local.js:116` — the fingerprint hash in the failure build context

## Verification results

### Task 10: fingerprint step and reused build timing

The scratch app (Expo SDK 58, React Native 0.88, `development` simulator
profile, eas-cli 25.3.0) is a workspace folder of a Dev Containers window on the
Mac. Both extensions were packaged from plume-works/vscode-expo-bridge
`2d8db83`. Times run from the `eas-host` request to its result:

| Build                          | Result                               | Time        |
| ------------------------------ | ------------------------------------ | ----------- |
| cold, `--clean`                | `built`, `reason: "clean-requested"` | 111.0 s     |
| repeat, no change (three runs) | `reused`                             | 0.68–0.72 s |

A reused build's total time includes the fingerprint step, both version probes,
the lookup, and the copy into `.tmp/expo-bridge/`, so the fingerprint step takes
under 0.72 s. The build log has no per-step timestamps. The clean build's log
names the fingerprint `c4bb2c64…` and the cache key, and says the artifact was
stored.

### Task 11: Mac round trip

Same Mac, app, and packaged extensions as Task 10, with Metro running in the
container on the forwarded port 8081.

| Step                                                           | Result                                                                                                                                                                   |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| JavaScript-only edit to `App.js`                               | `reused`; after `install` with no path and `launch`, the screenshot shows the edited text from Metro                                                                     |
| `expo-haptics` installed and imported                          | `built`, `reason: "no-match"` (96 s); the repeat build `reused`; the launched app shows `Haptics.impactAsync` as a function                                              |
| `--clean` after the cooldown was cleared                       | the modal read "Run a clean "development" Expo build on this Mac? It builds in full, reusing no earlier build."; `reason: "clean-requested"`                             |
| `release-sim` profile (`buildConfiguration: "Release"`), twice | `built`, `reason: "no-match"` both times, the same key; the artifact contains `main.jsbundle` and the log says it was not stored                                         |
| copy of the app as a second workspace folder `app2`            | first build `built`, `no-match`, stored under key `25f8…`; the first app's next build computed `25f8…` and built in full with `no-match`; `app2`'s repeat build `reused` |
| trust revoked through Manage Trusted Workspaces                | `build-cache/0696e519…` (the SHA-256 of the host path) was deleted, leaving `build-cache/` empty                                                                         |
