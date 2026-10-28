---
type: plan
created: 2026-10-24
release:
- bugs/expo-bridge-fix-terminal-remote-shell
description: Open the Expo bridge's one-click fix terminal with the Mac's own default terminal profile, resolved from the VS Code settings and found on the Mac, falling back to the Mac login shell, so a container profile of the same name no longer supplies a path the Mac lacks.
generated:
  by: claude-code/opus-5.5
  at: 2026-10-24T12:00:00Z
sources:
- resource: docs/knowledge/data/bugs/expo-bridge-fix-terminal-remote-shell.md
- resource: https://github.com/plume-works/vscode-expo-bridge
- resource: https://github.com/microsoft/vscode/blob/main/src/vs/platform/terminal/common/terminalPlatformConfiguration.ts
- resource: https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/terminal/browser/terminalProfileResolverService.ts
stage: done
completed: 2026-10-24
---

# Expo bridge fix terminal launches the Mac's own shell

## Context

[The Expo bridge's fix terminal launches the container's shell on the
Mac](../bugs/expo-bridge-fix-terminal-remote-shell.md): the host extension
creates the fix terminal with a `file:` cwd and no shell path, so VS Code
launches it on the Mac but resolves the default profile's name against the
profiles detected in the container. When the Mac's
`terminal.integrated.defaultProfile.osx` names a profile the container also has,
such as `fish` (`/usr/bin/fish` in the template image), the terminal fails to
launch and no fix runs.

Settled facts this plan builds on:

- **An explicit `shellPath` skips the default-profile lookup.**
  `resolveShellLaunchConfig` resolves a given executable as its own profile and
  calls `getDefaultProfile` only when none is given.
- **VS Code's built-in macOS profiles are setting defaults.**
  `terminal.integrated.profiles.osx` defaults to `bash`, `zsh`, and `fish`
  entries with a bare `path` and `args: ['-l']`, plus `tmux` and `pwsh`, so
  `getConfiguration` returns them even when the user's settings define none.
- **Both settings are `restricted` and window-scoped.** A workspace can set
  them, and VS Code applies a workspace value only in a trusted workspace. The
  host extension declares no `untrustedWorkspaces` capability, so it never runs
  in an untrusted workspace.
- **The fix commands are shell-neutral.** `planFixes` emits only `brew install`,
  `sudo xcode-select`, `sudo xcodebuild`, and `xcodebuild` commands, which every
  supported shell runs alike; the `sudo` steps need a real pty.
- **The host already resolves Mac tools.** `captureLoginEnv` returns the login
  environment with the Homebrew prefixes, and `lookupTool` finds a bare name on
  its `PATH`.

## Approach

**The fix terminal launches what VS Code would launch on the Mac.** Before
creating the terminal, the host reads `terminal.integrated.defaultProfile.osx`
and `terminal.integrated.profiles.osx` with `getConfiguration().get()` — the
merged value, the same one VS Code itself applies — and resolves the profile on
the Mac:

1. the default profile name is a non-empty string and names an object in
   `profiles.osx`;
2. that profile has a `path`, a string or an array of candidates, and no
   `source`;
3. the first candidate that exists on the Mac wins: an absolute path that
   exists, or a bare name found by `lookupTool` on the login environment's
   `PATH`. A candidate containing `${` or a relative path with a `/` is skipped;
4. the terminal gets that path as `shellPath`, the profile's `args` as
   `shellArgs` when it is a string array, and the profile's `env` when it is an
   object.

When any step fails, the terminal uses the Mac login shell the host already
treats as the user's, `process.env.SHELL ?? "/bin/zsh"`, with `shellArgs`
`["-l"]`, matching the `-l` VS Code's built-in macOS profiles pass. The terminal
keeps its name, `Expo Bridge fix`, and its `file:` home-directory cwd.

The resolution is a pure function with its inputs passed in — the two setting
values, the login environment, a file-exists check, and the login shell — so
every branch is unit-tested without VS Code.

Rejected: `$SHELL -l` alone, without the profile — it fixes the launch but
ignores a default profile that differs from the login shell. Rejected: reading
only the user-level values with `inspect().globalValue` — it diverges from what
VS Code launches for every other local terminal. A trusted workspace, which the
container can write, can therefore choose the Mac shell, as it already can for
every local terminal VS Code opens. `lookupDocker` reads only the user-level
`dev.containers.dockerPath` for the same reason of matching VS Code: that
setting is application-scoped, so VS Code ignores workspace values. Rejected: a
`Pseudoterminal` that runs the commands with the login environment — it has no
pty, so the `sudo` prompts fail.

Assumptions:

- The login environment is captured when the fix starts. If capturing it fails,
  bare candidates are looked up on the extension host's own `PATH` with the
  Homebrew prefixes.
- Profile fields other than `path`, `args`, `env`, and `source` —
  `overrideName`, `icon`, `color` — are ignored.

## Implementation Steps

### Task 1: Resolve the fix terminal's shell

**Files:** Create: `packages/host/src/shell.ts`,
`packages/host/test/shell.test.ts`, in `plume-works/vscode-expo-bridge`

- [x] A pure `fixTerminalShell` returns `{ shellPath, shellArgs?, env? }` from
  the default profile name, the profiles value, the login environment, a
  file-exists check, and the login shell, following the Approach's four steps
  and its fallback.
  - **Evidence:** `plume-works/vscode-expo-bridge` commit `857f5b1` on branch
    `fix-terminal-mac-shell`, `packages/host/src/shell.ts`; `bun run typecheck`
    passes.
- [x] `bun test packages/host/test/shell.test.ts` covers: a default profile
  whose bare path is found on the login `PATH` with its `args`; an absolute path
  that exists; an array whose first candidate is missing; the profile's `env`
  passed through; and the fallback to the login shell with `["-l"]` for an unset
  default, a name with no profile, a `null` profile, a profile with `source`, a
  candidate containing `${`, and no candidate existing on the Mac.
  - **Evidence:** `packages/host/test/shell.test.ts` in commit `857f5b1`; 11
    tests pass under `bun test packages/host/test/shell.test.ts`.

### Task 2: The fix terminal uses the resolved shell

**Files:** Modify: `packages/host/src/extension.ts`, in
`plume-works/vscode-expo-bridge`

- [x] The `expoBridge.fix` command captures the login environment, reads both
  settings with `getConfiguration("terminal.integrated").get()`, and passes
  `fixTerminalShell`'s result to `createTerminal` alongside the existing name
  and `file:` cwd. `bun run build` and `bun run lint` pass.
  - **Evidence:** `plume-works/vscode-expo-bridge` commit `04e4f9d` (`fixShell`
    in `packages/host/src/extension.ts`); `bun run build`, `bun run lint`, and
    `bun test` (263 pass) pass on a clean checkout of it.

### Task 3: Version and README

**Files:** Modify: the three extensions' `package.json` versions (through
`bun run bump`), `packages/host/README.md`, in `plume-works/vscode-expo-bridge`

- [x] The pack and both extensions carry the next patch version, and the host
  README says the fix terminal opens with the Mac's default terminal profile, or
  the login shell when that profile is not found on the Mac.
  - **Evidence:** `plume-works/vscode-expo-bridge` commit `a12c583`:
    `bun run bump` sets all three extensions to 0.2.4, and
    `packages/host/README.md` describes the fix terminal's shell.

### Task 4: Sibling repository CI passes

**Files:** none

- [x] The sibling repository's CI passes on the commit that completes Tasks 1–3.
  - **Evidence:** `build` passes in CI run `40058371319` on
    `plume-works/vscode-expo-bridge#21` at `6edf829`, which is `a12c583` plus a
    `.gitignore` entry for `.tmp/` and `*.tsbuildinfo`.

### Task 5: Mac round trip from the packaged VSIX files

**Files:** none — on a Mac, the host extension packaged from the Task 4 commit
sideloaded, this repository opened in a Dev Containers window

- [x] With `terminal.integrated.defaultProfile.osx` set to `fish` and fish
  installed through Homebrew, the bug's reproduction opens the fix terminal in
  the Mac's fish and the fix runs.
  - **Evidence:** Mac run on 2026-10-24 with the host and workspace 0.2.4 VSIX
    files packaged from `6edf829`: the bun fix opened in the Mac's fish and ran
    `brew install oven-sh/bun/bun`. Its notice persisting is [a separate
    bug](../bugs/expo-bridge-bun-fix-misses-path-bun.md).
- [x] With the default profile set to `bash`, the fix terminal opens in the
  first `bash` on the Mac's login `PATH`.
  - **Evidence:** Mac run on 2026-10-24 with the same VSIX files: the fix
    terminal's `$0` and `ps -p $$` are `/bin/bash`, the only `bash` that
    `which -a bash` lists, and the fix ran.
- [x] With the default profile unset, and set to a name `profiles.osx` lacks,
  the fix terminal opens in the login shell.
  - **Evidence:** Mac runs on 2026-10-24 with the same VSIX files, the default
    profile unset and then `nosuchprofile`: each fix terminal ran
    `/opt/homebrew/bin/fish -l`, the Mac's `$SHELL`, and `status is-login` held.

### Task 6: Record the fix in this repository's project memory

**Files:** Modify:
`docs/knowledge/data/bugs/expo-bridge-fix-terminal-remote-shell.md`,
`docs/knowledge/data/architecture/vscode-expo-bridge.md`

- [x] The bug's `## Fix` describes the fix and its `## Key references` point at
  the current lines; the architecture document says the fix terminal resolves
  the Mac's default profile on the Mac and falls back to the login shell, with
  this plan's rejected alternatives. `iwe normalize` and `iwe schema validate`
  pass.
  - **Evidence:** the commit that ticks this box updates the bug's `## Fix` and
    its anchors at `6edf829`, and adds the fix-terminal constraint and three
    rejected alternatives to `data/architecture/vscode-expo-bridge`;
    `iwe normalize` and `iwe schema validate` pass.

## Spec changes

None in `data/spec/` — this repository's spec covers only the template wiring,
which this plan leaves unchanged. The behavior lives in
`plume-works/vscode-expo-bridge`; its intended post-change behavior, which Tasks
1 and 5 verify:

``` markdown
## ADDED Requirements

### Requirement: the fix terminal runs a Mac shell

The host extension SHALL open the one-click fix terminal on the Mac with the
shell of the Mac's default terminal profile, resolved from the merged
`terminal.integrated.defaultProfile.osx` and `terminal.integrated.profiles.osx`
values to the first profile path that exists on the Mac, and SHALL otherwise
open it with the Mac login shell and `-l`. It SHALL never take a shell path from
the profiles detected in the container.

#### Scenario: a default profile the container also has

- **GIVEN** `defaultProfile.osx` is `fish`, the profile's path is `fish`, and
  the container has `/usr/bin/fish`
- **WHEN** the user picks a fix
- **THEN** the fix terminal runs the `fish` found on the Mac's login `PATH`,
  with the profile's `args`

#### Scenario: no default profile

- **GIVEN** `defaultProfile.osx` is unset
- **WHEN** the user picks a fix
- **THEN** the fix terminal runs `$SHELL -l`, or `/bin/zsh -l` when `SHELL` is
  unset

#### Scenario: a profile the Mac cannot resolve

- **GIVEN** the default profile names no profile, a `null` profile, a profile
  with `source`, or paths none of which exists on the Mac or that use variables
- **WHEN** the user picks a fix
- **THEN** the fix terminal runs the Mac login shell with `-l`
```

## Verification

- In `plume-works/vscode-expo-bridge`, `bun test` passes, and the sibling CI
  passes (Task 4).
- Task 5's Mac runs behave as described.
- `iwe normalize` and `iwe schema validate` pass.

## Out of scope

- Publishing the patch release; tagging and marketplace approval follow the
  sibling repository's release workflow.
- Profile features beyond `path`, `args`, and `env`: `source` profiles, `${...}`
  variables, and the profile's name, icon, and color.
- Terminals other than the fix terminal; the host opens no other.

## Key references

Verified anchor points (line numbers as of 2026-10-24):

In `plume-works/vscode-expo-bridge` at `8d8b77c`:

- `packages/host/src/extension.ts:122` — `captureLoginEnv()` in
  `buildDispatchDeps`
- `packages/host/src/extension.ts:286` — the `expoBridge.fix` command
- `packages/host/src/extension.ts:316` — `createTerminal` for the fix, with a
  `file:` cwd and no `shellPath`
- `packages/host/src/env.ts:37` — `captureLoginEnv`; `:38` — the login shell,
  `process.env.SHELL ?? "/bin/zsh"`
- `packages/host/src/env.ts:49` — `lookupTool`
- `packages/host/src/env.ts:68` — `lookupDocker`, whose absolute,
  slash-containing, and bare-name candidate handling step 3 mirrors
- `packages/host/src/fix.ts:21` — `planFixes`, the fix commands
- `packages/host/package.json:18` — `extensionKind: ["ui"]`, no
  `untrustedWorkspaces` capability
- `packages/host/README.md:12` — the commands list naming the fix

In `microsoft/vscode` `main`:

- `src/vs/platform/terminal/common/terminalPlatformConfiguration.ts:287` —
  `profiles.osx`, `restricted`; `:292`–`:303` — the built-in `bash`, `zsh`, and
  `fish` profiles with `args: ['-l']`
- `src/vs/platform/terminal/common/terminalPlatformConfiguration.ts:462` —
  `defaultProfile.osx`, `restricted`
- `src/vs/workbench/contrib/terminal/browser/terminalProfileResolverService.ts:110`
  — `resolveShellLaunchConfig`; `:113` — a given executable bypasses `:121`
  `getDefaultProfile`
