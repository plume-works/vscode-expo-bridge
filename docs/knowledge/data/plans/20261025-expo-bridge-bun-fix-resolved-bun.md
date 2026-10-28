---
type: plan
created: 2026-10-25
release:
- bugs/expo-bridge-bun-fix-misses-path-bun
description: Make the Expo bridge's bun fix upgrade the bun the bun check resolved — through Homebrew for a Homebrew bun, through that binary's own bun upgrade for a bun.sh install, and with no command for any other origin — and note once per path pair when that bun shadows a newer one later on the PATH.
generated:
  by: claude-code/opus-5.5
  at: 2026-10-25T22:22:41Z
sources:
- resource: docs/knowledge/data/bugs/expo-bridge-bun-fix-misses-path-bun.md
- resource: docs/knowledge/data/architecture/vscode-expo-bridge.md
- resource: https://github.com/plume-works/vscode-expo-bridge
- resource: https://github.com/oven-sh/bun/blob/main/src/runtime/cli/upgrade_command.rs
- resource: https://github.com/oven-sh/homebrew-bun/blob/main/Formula/bun.rb
stage: done
completed: 2026-10-25
---

# Expo bridge bun fix upgrades the bun the check runs

## Context

[The Expo bridge's bun fix upgrades a bun the check never
runs](../bugs/expo-bridge-bun-fix-misses-path-bun.md): the bun check runs the
first `bun` on the Mac's login `PATH`, and the fix always runs
`brew install oven-sh/bun/bun`. When a stale bun.sh install in `~/.bun/bin`
comes ahead of Homebrew's bun, the fix changes Homebrew's copy, the check keeps
failing, and the fix is offered forever.

Settled facts this plan builds on:

- **The check resolves the bun the build runs.** `build` finds bun with the same
  `lookupTool("bun", env)` as the check and runs `eas-cli` as `<bun> x`, so the
  first bun on the login `PATH` is the one that must meet the container's
  version.
- **The fix terminal's `PATH` is not the check's.** The fix commands are typed
  into the Mac's default terminal profile, whose `env` and shell a trusted
  workspace can choose, and which lacks the Homebrew prefixes the host prepends.
  A bare `bun` there may name a different binary.
- **`bun upgrade` does not detect Homebrew.** It downloads the release and
  replaces its own executable path in place. On a Homebrew bun that path is the
  file under `/opt/homebrew/Cellar/bun/<version>/`, so Homebrew would keep
  recording the old version.
- **A bare `bun` formula name resolves to the installed formula.** With
  `oven-sh/bun/bun` installed, Homebrew resolves `bun` to that tap's formula
  ahead of `homebrew/core/bun`, so `brew upgrade bun` upgrades whichever `bun`
  formula is installed. Task 6 confirms it on a Mac.
- **The status result goes to the container.** `dispatch` returns `status`'s
  `StatusResult` to the workspace extension, and each check carries only `ok`
  and a `detail`.

## Approach

**The fix acts on the bun the check resolved, chosen by where it came from.** On
the host, when the bun check fails, a pure resolver takes the login environment
and classifies `lookupTool("bun", env)`:

| Resolved bun                                                                  | Fix command                                                                                                     |
| ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| none on the `PATH`                                                            | `brew install oven-sh/bun/bun`                                                                                  |
| its `realpath` is under `/opt/homebrew/Cellar/`                               | `brew upgrade bun`                                                                                              |
| it is `$BUN_INSTALL/bin/bun`, or `~/.bun/bin/bun` when `BUN_INSTALL` is unset | `'<resolved path>' upgrade`                                                                                     |
| anything else, or a path containing `'` or `\`                                | no command; the step's detail names the path and says to update that bun or put a newer one first on the `PATH` |

The bun.sh command uses the resolved absolute path in single quotes, which fish,
zsh, and bash read alike, so the fix commands stay shell-neutral. A path
containing `'` or `\` is not quoted the same way by fish, so it gets no command.

**A one-time shadowing note.** When the check fails, the resolver also runs
`--version` on each later `bun` on the `PATH` whose `realpath` differs from the
resolved one. The first that meets the container's version is the shadowed bun.
The host then shows, once per pair of resolved path and shadowed path, a notice
naming both paths and versions and saying the fix upgrades the first. The noted
pairs are kept in the host extension's `globalState`, so a window reload does
not repeat the note. The fix still upgrades the resolved bun; the note only
explains why.

**The resolution stays on the host.** `status` and the protocol are unchanged.
`planFixes` takes the resolver's result alongside the `StatusResult`, and the
host computes it where it already plans fixes: the status bar update and the fix
command.

Rejected: changing the check to pick the newest or the Homebrew bun — `build`
would still run the stale one. Rejected: a bare `bun upgrade` in the fix
terminal — the terminal's `PATH` can resolve a different bun. Rejected:
`bun upgrade` for a Homebrew bun — it replaces the Cellar file and leaves
Homebrew's version record wrong. Rejected: sending the resolved path in the
status result — only the host acts on it, and it would change the protocol.
Rejected: `homebrew-core`'s `bun` for a fresh install — `oven-sh/bun/bun`
installs bun's own release builds, so its version tracks bun.sh.

Assumptions:

- The resolver uses a fresh `captureLoginEnv()`, the environment `status` uses.
- When the container's bun version is unknown, no shadowed bun is looked for.
- A step with no command is shown in the status bar and the fix picker with its
  detail; picking it shows the detail in a message instead of opening a
  terminal.

## Implementation Steps

### Task 1: Resolve and classify the Mac's bun

**Files:** Create: `packages/host/src/bunfix.ts`,
`packages/host/test/bunfix.test.ts`, in `plume-works/vscode-expo-bridge`

- [x] A pure resolver takes the login environment, a file-exists check, a
  `realpath`, and the home directory, and returns the resolved bun's path and
  the fix command per the Approach's table, or no command with a detail naming
  the path.
  - **Evidence:** `plume-works/vscode-expo-bridge` commit `eebf019` on branch
    `expo-bridge-bun-fix-resolved-bun`, `resolveBunFix` in
    `packages/host/src/bunfix.ts`; `bun run typecheck` passes.
- [x] `bun test packages/host/test/bunfix.test.ts` covers each row of the table:
  no bun; a `/opt/homebrew/bin/bun` symlink into the Cellar; `~/.bun/bin/bun`
  with `BUN_INSTALL` unset; `$BUN_INSTALL/bin/bun`; a mise-style shim path; a
  path containing `'`; and a stale `~/.bun/bin/bun` ahead of Homebrew's, which
  yields `'<home>/.bun/bin/bun' upgrade`.
  - **Evidence:** `packages/host/test/bunfix.test.ts` in commit `eebf019`; 8
    tests pass under `bun test packages/host/test/bunfix.test.ts`.

### Task 2: Find a shadowed bun and note it once per path pair

**Files:** Modify: `packages/host/src/bunfix.ts`,
`packages/host/test/bunfix.test.ts`, in `plume-works/vscode-expo-bridge`

- [x] Given the container's bun version and a runner, the resolver returns the
  first later `bun` on the `PATH`, with a different `realpath`, whose
  `--version` meets the container's version; a store over a `Memento` reports
  whether a resolved-and-shadowed pair was already noted and records it.
  - **Evidence:** `plume-works/vscode-expo-bridge` commit `bcd31a8`,
    `findShadowedBun` and `ShadowNotes` in `packages/host/src/bunfix.ts`;
    `bun run typecheck` passes.
- [x] `bun test packages/host/test/bunfix.test.ts` covers: a newer Homebrew bun
  behind a stale bun.sh bun is found; a later entry with the resolved bun's
  `realpath` is skipped; a later bun older than the container's is not a
  shadowed bun; no lookup without a container version; a noted pair is not noted
  again; a different pair is noted.
  - **Evidence:** `packages/host/test/bunfix.test.ts` in commit `bcd31a8`; 15
    tests pass under `bun test packages/host/test/bunfix.test.ts`.

### Task 3: The fix and the status bar use the resolution

**Files:** Modify: `packages/host/src/fix.ts`, `packages/host/src/extension.ts`,
`packages/host/test/fix.test.ts`, in `plume-works/vscode-expo-bridge`

- [x] `planFixes` takes the resolver's result and uses its command, or its
  detail and no command, for the bun step; `showFixes` and the `expoBridge.fix`
  command compute that result on the host when the bun check fails, show the
  shadowing note once per pair through `context.globalState`, and a picked step
  with no command shows its detail instead of opening a terminal.
  - **Evidence:** `plume-works/vscode-expo-bridge` commit `a6dba1b`:
    `planFixes(status, bun)` in `packages/host/src/fix.ts`, and `planHostFixes`,
    `ShadowNotes` over `context.globalState`, and the no-command branch of
    `expoBridge.fix` in `packages/host/src/extension.ts`.
- [x] `bun test packages/host/test/fix.test.ts` covers the bun step's command
  for each origin and the step with no command; `bun run build`, `bun run lint`,
  and `bun test` pass.
  - **Evidence:** `packages/host/test/fix.test.ts` in commit `a6dba1b`;
    `bun run build`, `bun run lint`, and `bun test` (328 pass) pass on it.

### Task 4: Version and README

**Files:** Modify: the three extensions' `package.json` versions (through
`bun run bump`), `packages/host/README.md`, in `plume-works/vscode-expo-bridge`

- [x] The pack and both extensions carry the next patch version, and the host
  README says the bun fix upgrades the bun first on the Mac's login `PATH` —
  through Homebrew or `bun upgrade` according to how it was installed — and
  notes once when that bun shadows a newer one.
  - **Evidence:** `plume-works/vscode-expo-bridge` commit `e037795`:
    `bun run bump` sets all three extensions to 0.2.6, and
    `packages/host/README.md` describes the bun fix.

### Task 5: Sibling repository CI passes

**Files:** none

- [x] The sibling repository's CI passes on the commit that completes Tasks 1–4.
  - **Evidence:** `build` passes in CI run `40210051177` on
    `plume-works/vscode-expo-bridge#24` at `e037795`.

### Task 6: Mac round trip from the packaged VSIX files

**Files:** none — on an Apple silicon Mac, the host extension packaged from the
Task 5 commit sideloaded, an Expo consumer opened in a Dev Containers window

- [x] With the bug's reproduction — a bun.sh bun older than the container's in
  `~/.bun/bin` ahead of Homebrew's `oven-sh/bun/bun` at the container's version
  — the shadowing note names both paths once, the fix runs
  `'<home>/.bun/bin/bun' upgrade`, and the bun fix is no longer offered.
  - **Evidence:** Mac run on 2026-10-25 with the host 0.2.6 VSIX packaged from
    `e037795`, the container's bun 1.4.3, `~/.bun/bin/bun` 1.4.2 ahead of
    Homebrew's 1.4.4: `status` failed the bun check, one notice named
    `/Users/antonmatosov/.bun/bin/bun 1.4.2` and `/opt/homebrew/bin/bun 1.4.4`
    across three `status` runs, the fix ran
    `'/Users/antonmatosov/.bun/bin/bun' upgrade` to 1.4.4, and the bun fix was
    no longer offered.
- [x] After restoring the older bun.sh bun and reloading the window, the bun fix
  is offered again and the shadowing note is not shown again.
  - **Evidence:** Mac run on 2026-10-25, same VSIX: after reinstalling bun.sh
    1.4.2 and reloading the window, the bun fix was offered and ran
    `'/Users/antonmatosov/.bun/bin/bun' upgrade` again, with no second notice.
- [x] With `oven-sh/bun/bun` installed, `brew upgrade --dry-run bun` names
  `oven-sh/bun/bun`, not `homebrew/core/bun`.
  - **Evidence:** Mac run on 2026-10-25: `brew upgrade --dry-run bun` prints
    `oven-sh/bun/bun 1.4.4 already installed`, and `brew info bun` warns that
    `bun` shadows `homebrew/core/bun`.

### Task 7: Record the fix in this repository's project memory

**Files:** Modify:
`docs/knowledge/data/bugs/expo-bridge-bun-fix-misses-path-bun.md`,
`docs/knowledge/data/architecture/vscode-expo-bridge.md`

- [x] The bug's `## Fix` describes the fix and its `## Key references` point at
  the current lines; the architecture document says the bun fix acts on the bun
  the check resolved, by origin, with this plan's rejected alternatives.
  `iwe normalize` and `iwe schema validate` pass.
  - **Evidence:** the commit that ticks this box rewrites the bug's `## Fix` and
    its anchors at `d53478a`, and adds the bun-fix constraint and five rejected
    alternatives to `data/architecture/vscode-expo-bridge`; `iwe normalize` and
    `iwe schema validate` pass.

## Spec changes

None in `data/spec/` — this repository's spec covers only the template wiring,
which this plan leaves unchanged. The behavior lives in
`plume-works/vscode-expo-bridge`; its intended post-change behavior, which Tasks
1–3 and 6 verify:

``` markdown
## ADDED Requirements

### Requirement: the bun fix upgrades the bun the check resolved

When the bun check fails, the host extension SHALL offer a fix that acts on the
first `bun` on the Mac's login `PATH`, the one `build` runs: `brew upgrade bun`
when its real path is under `/opt/homebrew/Cellar/`, that binary's absolute path
followed by `upgrade` when it is the bun.sh install, `brew install
oven-sh/bun/bun` when no bun is found, and no command, with a detail naming the
path, for any other bun. The resolved path SHALL NOT be sent to the container.

#### Scenario: a stale bun.sh bun ahead of Homebrew's

- **GIVEN** `~/.bun/bin/bun` is older than the container's bun and comes before
  `/opt/homebrew/bin` on the login `PATH`
- **WHEN** the user picks the bun fix
- **THEN** the fix terminal runs `'<home>/.bun/bin/bun' upgrade`

#### Scenario: an outdated Homebrew bun

- **GIVEN** the first bun on the login `PATH` resolves under
  `/opt/homebrew/Cellar/` and is older than the container's
- **WHEN** the user picks the bun fix
- **THEN** the fix terminal runs `brew upgrade bun`

#### Scenario: no bun

- **GIVEN** no `bun` is on the login `PATH`
- **WHEN** the user picks the bun fix
- **THEN** the fix terminal runs `brew install oven-sh/bun/bun`

#### Scenario: a bun of unknown origin

- **GIVEN** the first bun on the login `PATH` is neither under the Cellar nor
  the bun.sh install
- **WHEN** the user picks the bun fix
- **THEN** no terminal opens, and the message names that bun's path

### Requirement: a shadowed bun is noted once per path pair

When the bun check fails and a later `bun` on the login `PATH` meets the
container's version, the host extension SHALL show a notice naming both paths
and versions, once per pair of paths, remembered across window reloads.

#### Scenario: the same shadowing after a reload

- **GIVEN** the notice for a pair of paths was shown
- **WHEN** the window reloads and the bun check fails with the same pair
- **THEN** the notice is not shown again
```

## Verification

- In `plume-works/vscode-expo-bridge`, `bun test` passes, and the sibling CI
  passes (Task 5).
- Task 6's Mac runs behave as described.
- `iwe normalize` and `iwe schema validate` pass.

## Out of scope

- Intel Macs and `/usr/local` Homebrew prefixes; the bridge supports Apple
  silicon Macs.
- The same shadowing for the CocoaPods, fastlane, and Node fixes.
- Removing or reordering the shadowing bun; the user's `PATH` is theirs.
- Version managers such as mise, asdf, and proto, and npm or nix installs,
  beyond naming the path.
- Publishing the patch release; tagging and marketplace approval follow the
  sibling repository's release workflow.

## Key references

Verified anchor points (line numbers as of 2026-10-25):

In `plume-works/vscode-expo-bridge` at `0c786bd`:

- `packages/host/src/fix.ts:21` — `planFixes`; `:54` — the bun step; `:58` —
  `brew install oven-sh/bun/bun`
- `packages/host/src/status.ts:37` — `toolVersion`; `:106` — the bun check;
  `:112` — the "older than the container's" detail
- `packages/host/src/build.ts:75` — `build` resolves bun with `lookupTool`
- `packages/host/src/buildkey.ts:92` — `<bun> x eas-cli@<spec> --version`
- `packages/host/src/env.ts:26` — `withHomebrewPath`; `:37` — `captureLoginEnv`;
  `:49` — `lookupTool`, first match on `PATH`
- `packages/host/src/dispatch.ts:64` — `status`'s result returned to the
  container
- `packages/host/src/extension.ts:49` — `showFixes`; `:117` — `fixShell`; `:210`
  — `TrustStore` over `context.globalState`; `:224` — `FixNotices`; `:225` —
  `recheck`; `:258` — `showFixes` after a dispatched `status`; `:324` — the
  `expoBridge.fix` command; `:354` — `createTerminal`
- `packages/host/src/fixrun.ts:5` — `runCommands`
- `packages/host/README.md:21` — the fix terminal paragraph
- `packages/host/package.json:6` — version `0.2.5`

In `oven-sh/bun` `main`:

- `src/runtime/cli/upgrade_command.rs:590` — the already-latest message; `:1080`
  — the destination is `self_exe_path()`

In `oven-sh/homebrew-bun` `main`:

- `Formula/bun.rb` — installs the `bun-darwin-aarch64.zip` release with
  `bin.install "bun"`
