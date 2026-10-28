---
type: plan
created: 2026-10-15
release:
- features/vscode-expo-bridge
description: Two VS Code extensions in the sibling repository plume-works/vscode-expo-bridge, bundled as one extension pack, that let agents in a devcontainer opened on a Mac build, install, launch, and screenshot an Expo iOS app on that Mac through a fixed Expo-only action set — trusted per workspace on the Mac, confirmed per build, and built unsandboxed as the Mac user — with EAS cloud as the fallback; the template's Expo profile lists the pack.
generated:
  by: claude-code/opus-5.5
  at: 2026-10-23T12:00:00Z
sources:
- resource: docs/knowledge/data/plans/20261014-expo-eas-template-profile.md
- resource: .devcontainer/devcontainer.json
- resource: .agents/plugins/agentdev/skills/template-consume/references/consumption-guide.md
- resource: https://docs.expo.dev/build-reference/local-builds/
- resource: https://github.com/expo/eas-build
- resource: https://code.visualstudio.com/api/advanced-topics/remote-extensions
- resource: https://code.visualstudio.com/docs/devcontainers/containers
- resource: https://code.visualstudio.com/api/working-with-extensions/publishing-extension
- resource: https://devblogs.microsoft.com/devops/retirement-of-global-personal-access-tokens-in-azure-devops
- resource: https://docs.github.com/en/actions/how-tos/secure-your-work/security-harden-deployments/oidc-in-azure
- resource: https://learn.microsoft.com/entra/workload-id/workload-identities-github-immutable-subjects
- resource: https://github.com/eclipse/openvsx/wiki/Publishing-Extensions
- resource: https://github.com/plume-works/vscode-expo-bridge
- resource: https://github.com/plume-works/agent-expo-bridge-spikes
- resource: https://blog.theredguild.org/leveraging-vscode-internals-to-escape-containers/
- resource: https://github.com/microsoft/vscode/issues/287765
- resource: https://developer.apple.com/videos/play/wwdc19/418/
stage: done
completed: 2026-10-23
---

# Build iOS on the Mac host through a VS Code bridge

## Context

The [Expo profile](20261014-expo-eas-template-profile.md) builds iOS on EAS
cloud Macs from the Linux devcontainer. When that devcontainer is opened by VS
Code on a Mac, the Mac itself has Xcode and the iOS Simulator, and a build there
costs no EAS quota and lets agents see the running app. The user-facing behavior
is the [VS Code Expo bridge](../features/vscode-expo-bridge.md) feature.

The pieces that make this possible:

- **`eas build --local`** (eas-cli 25.3.0) runs the EAS build steps on the local
  machine. It builds in a working directory under macOS's `$TMPDIR` with its own
  dependency install, reads the same `eas.json` profiles, and authenticates with
  `EXPO_TOKEN`. It uses the host's bun whatever the `bun` field of `eas.json`
  says, and does not resolve EAS "Secret" environment variables.
  `EAS_LOCAL_BUILD_ARTIFACTS_DIR` sets where the artifact lands. It packs
  uncommitted and untracked files with default settings. It runs project code on
  the build machine: package lifecycle scripts, `eas-build-*` hooks,
  `app.config.js`, config plugins, the `Podfile`, and Xcode build phases.
- **`eas init` writes `extra.eas.projectId` into `app.json`**, a tracked project
  file.
- **VS Code routes a command to whichever extension host registered it.** A `ui`
  extension runs in the Mac's local extension host with full Node; a `workspace`
  extension runs in the container. One extension runs in exactly one host.
  Command arguments and results cross the boundary as JSON. A container-side
  extension reaches the Mac through VS Code's own commands — a local terminal,
  the clipboard — regardless of any extension the bridge installs.
- **The workspace is one directory on disk** seen by both sides, so a file the
  Mac writes under the workspace is visible in the container at once. The
  container can also place symlinks in it that resolve anywhere on the Mac.
- **The Mac user's login shell may be fish** or another shell that does not
  accept POSIX `sh` syntax.

## Approach

Two extensions in the sibling repository
[plume-works/vscode-expo-bridge](https://github.com/plume-works/vscode-expo-bridge),
bundled by the extension pack `plume-works.vscode-expo-bridge`:

```
 devcontainer                                 Mac host
┌──────────────────────────────┐   VS Code   ┌───────────────────────────────────┐
│ eas-host <action> ...        │   command   │ host extension (ui)               │
│   │ unix socket              │   routing   │  ├ trust + build confirmation     │
│   ▼                          │ ──────────▶ │  ├ resolves the workspace's host  │
│ workspace extension ─────────┤             │  │   path, validates arguments     │
│                              │             │  ├ eas build --local              │
│ tails the log file ◀─────────┼─workspace───┼──┤ xcrun simctl install/launch/   │
│ reads the artifact           │  directory  │  │   screenshot                   │
└──────────────────────────────┘             │  └ writes .tmp/expo-bridge/        │
                                             └───────────────────────────────────┘
```

**Security model.** A devcontainer window already grants the container reach
onto the Mac that the bridge neither adds nor can take away: through VS Code's
own commands a container-side extension opens a local terminal and runs a
command on the Mac, and the SSH and GPG agents are forwarded into the container.
The bridge therefore does not contain a hostile container — nothing a workspace
extension can install does. It is a consent surface, not a security boundary: it
adds no reach beyond what the window already grants, and its one privileged
action, `build`, runs project code on the Mac only behind per-workspace trust
and a per-build confirmation. The host extension treats every command invocation
as possibly the container's, whichever extension sent it, so pairing the two
extensions is not a boundary. The protocol document specified in Task 11 states
the model this way — a consent surface for a cooperative container — and does
not claim to defend against a hostile one. The checks are these:

- **Fixed Expo-only protocol.** The host extension accepts exactly these
  actions: `status`, `build`, `install`, `launch`, `screenshot`. It never runs a
  command string from the container. `build` takes a profile name that must
  exist in the workspace's `eas.json`; `install` takes a workspace-relative path
  that must resolve under `.tmp/expo-bridge/`; `launch` takes no argument and
  starts the app `install` last installed, by the `CFBundleIdentifier` in that
  artifact's `Info.plist`; `screenshot` takes no argument.
- **Per-workspace trust, granted only on the Mac.** The first request from a
  workspace with no recorded decision shows a VS Code prompt naming the
  workspace's host path. Allowing it records trust in the host extension's
  `globalState`, keyed by host path; declining fails the request. A command
  lists and revokes trusted workspaces. Trust and every other security setting
  are never read from workspace settings, `devcontainer.json`, or any other file
  the container can write.
- **A confirmation before every `build`.** The prompt names the profile and
  states that project code will run on the Mac with the user's privileges. Its
  answers are "Allow once", "Allow and don't ask for an hour", and "Allow and
  don't ask today"; a cooldown applies to that workspace only and is stored in
  `globalState`. A command ends a workspace's cooldown without touching its
  trust, so its next build asks again. `status`, `install`, `launch`, and
  `screenshot` never prompt beyond trust.
- **No containment of the build.** `build` runs
  `eas build --local -p ios --profile <name>` as the Mac user, unsandboxed, with
  no privileged setup on the Mac. Project code in the build can do anything the
  user can. Trust and the build confirmation are the only gate on it.
- **A pinned eas-cli.** `build` runs eas-cli through the Mac's bun as
  `bunx eas-cli@<spec>`, where `<spec>` is `cli.version` in the workspace's
  `eas.json`, Expo's own pin for the CLI, or `latest` when it is unset. A value
  that is not a semver version or range — `file:`, git, URL, alias, dist-tag —
  is refused. eas-cli is never a project dependency, which `expo doctor` flags,
  and nothing installs it on the Mac outside the build.
- **No project code outside `build`.** The host extension never evaluates
  `app.config.js` or any other project file as code. It reads only `eas.json`
  and `app.json`, as JSON, and refuses a symlink, a non-regular file, or a file
  over a size limit; an error returned to the container never quotes file
  contents.
- **Management commands are reachable from the container too.** The trust,
  token, and fix commands take no arguments, return nothing, and change nothing
  until the user answers a modal.
- **No-VCS packing.** The build always sets `EAS_NO_VCS=1`, so eas-cli writes
  nothing in the workspace's `.git`. Its archive still honors `.gitignore` and
  includes uncommitted and untracked files, and the bridge writes nothing in the
  workspace outside `.tmp/expo-bridge/`.
- **Safe paths and processes.** Every protocol path is resolved with `realpath`
  and rejected when any component is a symlink or the result leaves the
  workspace. Every file the host extension writes under `.tmp/expo-bridge/` is
  created under a fresh name with `O_CREAT | O_EXCL | O_NOFOLLOW_ANY`. The build
  writes its artifact into a directory private to the Mac, the host extension's
  global storage, and the host extension copies it in under that rule. `install`
  unpacks an artifact into a fresh private directory and rejects any archive
  entry that is absolute, contains `..`, or is a symlink. The host extension
  starts every process with `execFile` and an argument array, never a shell
  string.
- **`EXPO_TOKEN` in VS Code SecretStorage.** Commands set and clear the token on
  the Mac; the host extension puts it in the build's environment only. The build
  can still read it, so the README recommends a robot-account token scoped to
  the project.

**Host environment.** The host extension's processes (probes, the build,
`xcrun simctl`) run with the user's login environment, captured with
`$SHELL -l -c 'env -0'`, which fish and POSIX shells both accept, and starts its
processes directly with that environment — never through the login shell. Tool
lookup also searches Homebrew's prefixes `/opt/homebrew/bin` and
`/usr/local/bin`, so a shell configuration that omits them does not break the
bridge.

- **`status`** reports whether the bridge can serve a build: a Mac host, a
  workspace host path that exists locally, whether the workspace is trusted,
  Xcode, CocoaPods, fastlane, Node, the eas-cli version `build` runs, a host bun
  at least as new as the container's (the container sends its `bun --version`),
  `EXPO_TOKEN` stored in SecretStorage, `extra.eas.projectId` in `app.json`, an
  iOS simulator that is booted or can be booted, whether port 8081 is forwarded,
  and the protocol version.
- **The bridge boots the simulator.** When no simulator is booted, `install`,
  `launch`, and `screenshot` boot one headless through `xcrun simctl`: an
  existing iPhone on the newest available iOS runtime, or a new one when there
  is none. The user never opens a simulator app by hand.
- **Nothing Mac-specific lands in the shared workspace.** The host extension
  never runs `eas init`, `expo run:ios`, `expo prebuild`, or a package install
  in the workspace; the only files it writes there are under `.tmp/expo-bridge/`
  — logs, build artifacts, screenshots. Linking the EAS project is a one-time
  setup step done from the container, which `status` reports when missing.
- **One-click fix.** When `status` finds a missing tool, the host extension
  offers a fix in the VS Code UI that runs Homebrew in a visible local terminal.
  The offer is a status bar item in the Mac window that stays until a later
  `status` finds nothing to fix, plus a notification whenever the set of failing
  checks changes; clicking it opens a picker, which stays open when focus moves
  and shows each failing check's detail. One fix runs at a time; when its
  commands finish (VS Code's shell integration, VS Code 1.93 or later) or its
  terminal closes, the host re-runs `status` and the item clears or shows what
  still fails. Xcode is a guided step (it opens the App Store page), after which
  the fix runs `xcode-select`, accepts the license, and downloads the iOS
  platform. A fix is only ever started by the user's click, never by a protocol
  action.
- **`eas-host`** is the container-side command. The workspace extension installs
  it into `~/.local/bin` on activation and listens on a fixed socket; it streams
  the build log by tailing the log file the host extension writes. When the
  bridge is unavailable, `eas-host status` says so and exits non-zero, and the
  agent uses the Expo profile's EAS cloud path.
- **Dev-client loop.** Metro runs in the container; VS Code forwards port 8081
  to the Mac, where the simulator's development build connects to it, so the
  native build reruns only when native code changes. `launch` starts a
  development build with the expo-dev-client launch argument
  `--initialUrl http://localhost:8081`, so it loads the bundle without a tap or
  a URL-scheme prompt; `install` recognizes a development build by the `exp+…`
  URL scheme in its `Info.plist`, and any other app launches plainly.
- **Template wiring.** The Expo profile lists the extension pack, forwards 8081
  with VS Code's auto-forward notification silenced so it never covers the
  bridge's own notifications, and adds an `AGENTS.md` rule telling agents to use
  `eas-host` for iOS when `eas-host status` succeeds. Setup never pre-authorizes
  the bridge.
- **Host install.** Dev Containers installs every extension listed in
  `devcontainer.json` into the container, so the listed pack brings the
  workspace extension and leaves the host extension disabled there. The
  documented first-run step is one click on the host extension's **Install
  Locally** in the Extensions view, once per Mac. Rejected: listing only the
  workspace extension and telling users to install the pack on the Mac — a
  window opened without that step shows nothing to click.

The protocol and the security model are specified in the sibling repository,
which owns the code; this repository's spec covers only the template wiring, the
fallback, and that setup grants no trust.

Rejected: a generic host-command bridge such as `dc2host` — any process in the
container could run anything on the Mac. Rejected: wrapping `eas` so that
`eas build -p ios` routes to the Mac — Expo's plugin skills call `eas` directly,
and silently changing a third-party command's meaning is fragile. Rejected:
`expo run:ios` on the Mac — it builds in the shared workspace against the
container's Linux `node_modules`. Rejected: a self-hosted GitHub Actions runner
on the Mac — it needs CI plumbing and is not available from an open editor
window. Rejected: a host network port — the protocol travels over VS Code's
command routing, so the firewall allowlist does not change. Rejected: a single
extension whose host half registers a URI handler that `eas-host` reaches with
`code --open-url` — a URI handler returns nothing, so results would come back
only by polling files. Rejected: containing the build with `sandbox-exec` —
macOS does not apply a sandbox inside another, and the build's tools (SwiftPM)
sandbox themselves; turning their sandboxes off for one build depends on Expo's
script internals, Xcode's script-phase `PATH`, and an undocumented Xcode
default. Rejected: disabling SwiftPM's manifest sandbox through global Xcode
defaults — it weakens every Xcode build on the Mac. Rejected: building as a
dedicated low-privilege macOS user — it needs a second account, a sudoers rule,
and a root-owned wrapper installed with the user's admin password, a standing
privileged path on the Mac; and the account's home persists between builds, so
one hostile build can poison the next.

**Release sequence.** The packaged extensions run first from sideloaded VSIX
files on a Mac, then as pre-releases installed from the Visual Studio
Marketplace, and only then as releases; a release ships the code its pre-release
was tested with. The pack is not sideloaded, because it resolves its members
from a gallery. Rejected: publishing releases straight after CI — the unit tests
stub VS Code and every process, so a defect only a real window shows would first
appear in a public release.

**Publishing.** A `vX.Y.Z` tag push runs the sibling repository's release
workflow; nothing publishes from a merge alone. The workflow refuses a tag that
differs from the version of the three extension `package.json` files, packages
an odd minor as a pre-release, and publishes from a job in the GitHub
environment `release`, which waits for a required reviewer and accepts only `v*`
tags. The Visual Studio Marketplace takes the VSIX files through Microsoft Entra
ID: `azure/login` exchanges the job's GitHub OIDC token for one of a
user-assigned managed identity whose federated credential names that
environment, and `vsce publish --azure-credential` uses it, so no Marketplace
secret is stored. Open VSX takes an access token held as the environment secret
`OVSX_PAT`. The same run attaches the VSIX files to a GitHub Release. Rejected:
a Marketplace personal access token — publishing needs a global
(all-organizations) Azure DevOps token, and Azure DevOps blocks creating one
from 2026-03-15 and retires every one on 2026-12-01.

Assumptions:

- The extension IDs are `plume-works.vscode-expo-bridge` (the pack),
  `plume-works.vscode-expo-bridge-host` (`ui`), and
  `plume-works.vscode-expo-bridge-workspace` (`workspace`).
- The socket is `/tmp/vscode-expo-bridge.sock` inside the container; one VS Code
  window serves one container.
- The workspace extension activates on `workspaceContains:eas.json`.
- A declined trust prompt is remembered until revoked through the trust command,
  so a hostile workspace cannot re-prompt repeatedly.
- The first workspace folder is the Expo project root.
- CocoaPods and fastlane are owned by the one-click fix, not by the [macOS
  bootstrap](20261013-macos-native-bootstrap.md).
- After a container rebuild, a window runs the locally installed host extension
  without another click.
- The Marketplace pages show a corrected pack README only from the next
  published version; no version is published for the README change alone.
- Versions follow VS Code's pre-release convention: an odd minor for a
  pre-release, an even minor for a release, since the galleries accept only
  `major.minor.patch`. The pack and both extensions share one version, and every
  change bumps its patch.
- Installing the pack's pre-release installs its members' pre-releases.
- The workflow that prints the managed identity's Marketplace profile ID stays
  in the repository as a manual-dispatch workflow, for when the identity is
  replaced.

## Implementation Steps

### Task 1: Spike the bridge end to end

**Files:** Create: a scratch extension outside both repositories

- [x] A container-side command calls a `ui`-side command through
  `vscode.commands.executeCommand`, and the `ui` side resolves the workspace's
  host path from the remote window.
  - **Evidence:** Spike on 2026-10-21, macOS arm64 host, Dev Containers window.
    A request on a container socket reached a `ui`-kind command through
    `executeCommand`. The command decoded the folder URI authority
    `dev-container+<hex JSON>` and took its `hostPath`. It then read back, at
    that host path, a nonce file the container had written. The spike extensions
    are `extensions/ui` and `extensions/ws` in
    [plume-works/agent-expo-bridge-spikes](https://github.com/plume-works/agent-expo-bridge-spikes/tree/3409e51830b52545a8cfd911f2296423052a0617)
    at `3409e51`.
- [x] The `ui` side runs `eas build --local -p ios --profile development` for an
  `ios.simulator: true` profile on a blank `bun create expo` app, and the
  artifact is readable in the container.
  - **Evidence:** Spike on 2026-10-21 with eas-cli 25.3.0, Expo SDK 58 and EAS
    project `d67b0e6f-5880-4bab-b64b-77d1dd12519e`. The `ui` side ran the build,
    which exited 0. The container unpacked the resulting `.tar.gz` and read the
    `.app`'s `Info.plist`: `CFBundleSupportedPlatforms` is `iPhoneSimulator`.
    The scratch app is `scratch-app` in
    [plume-works/agent-expo-bridge-spikes](https://github.com/plume-works/agent-expo-bridge-spikes/tree/3409e51830b52545a8cfd911f2296423052a0617)
    at `3409e51`.

### Task 2: Spike the `eas build --local` behavior the design relies on

**Files:** none — run against the Task 1 scratch app on a Mac

- [x] The build runs outside the workspace: the workspace's `node_modules` is
  unchanged and no `ios/` directory appears in it.
  - **Evidence:** In the same build, the working directory was macOS's
    `$TMPDIR/eas-build-local-nodejs/<id>/build`. A hash of the workspace's
    `node_modules` file list (path, size, mtime) matched before and after, and
    no `ios/` appeared.
- [x] `EAS_LOCAL_BUILD_ARTIFACTS_DIR` set to `.tmp/expo-bridge/` places the
  artifact there.
  - **Evidence:** In the same build, `EAS_LOCAL_BUILD_ARTIFACTS_DIR` was set to
    the host path of `.tmp/expo-bridge/`. `build-<timestamp>.tar.gz` landed
    there and was visible from the container.
- [x] The build uses the host's bun regardless of the `bun` field in `eas.json`,
  as the build log reports.
  - **Evidence:** In the same build, the profile pinned `"bun": "1.1.0"`. The
    `INSTALL_DEPENDENCIES` and `PREBUILD` phases logged `bun install v1.4.3`,
    the host's bun. An earlier run with host bun 1.3.10 failed
    `bun install --frozen-lockfile` with `UnknownLockfileVersion` on a
    `bun.lock` written by the container's 1.4.3. That confirms the `status`
    bun-version check.
- [x] `EXPO_TOKEN` in the host environment authenticates the build with no
  `eas login`.
  - **Evidence:** In the same build, `EXPO_TOKEN` came only from the host login
    environment and no `eas login` was run. Both
    `eas init --non-interactive --force` and the build authenticated with it.
- [x] An EAS environment variable with "Secret" visibility is absent from the
  build, and the same variable set in the host environment is present.
  - **Evidence:** Spike build on 2026-10-21 for the `development` profile with
    `environment: development`. eas-cli logged that it loaded only "Plain text"
    and "Sensitive" variables, `SPIKE_PLAIN` alone. In the app config embedded
    in `EXConstants.bundle`, `SPIKE_PLAIN` is the EAS value and the Secret-only
    `SPIKE_SECRET_A` is unset. `SPIKE_SECRET_B`, a Secret on EAS that the `ui`
    side also put in the build's environment, carries the host value.
- [x] The built app contains a change to a tracked file that was not committed
  and a new untracked file. When either is missing, find the eas-cli setting
  that includes them.
  - **Evidence:** Spike builds on 2026-10-21 with default eas-cli VCS settings.
    An uncommitted `ios.infoPlist` marker and display name in `app.json` appear
    in the `.app`'s `Info.plist`. An untracked solid-red
    `assets/untracked-icon.png`, set as the icon, produced red
    `AppIcon60x60@2x.png` and `AppIcon76x76@2x~ipad.png`. An untracked
    `app.config.js` set the embedded `extra` values. No setting was needed.
- [x] Any check that fails is recorded under `## Verification results` and the
  plan goes back to revise before Task 11.
  - **Evidence:** Every Task 2 check above passed, so there was nothing to
    record.

### Task 3: Spike how Expo's plugin skills invoke `eas`

**Files:** none — read `expo/skills`

- [x] Every build command in the skills of `expo@claude-plugins-official` is a
  direct `eas` invocation with no configurable command or hook; when one exists,
  record it under `## Verification results` and take the separate-command
  decision back to revise before Task 11.
  - **Evidence:** `anthropics/claude-plugins-official` pins `expo` to
    `expo/skills@d4f484024fec15196bfd3c272e953e3f983972cf` (`plugins/expo`). At
    that commit, the 29 build invocations across 12 files in
    `plugins/expo/skills/` are literal `eas build …` or
    `npx eas-cli@latest build …`. `hooks/hooks.json` holds only the
    `skill-event.cjs` telemetry hooks (`PostToolUse` on `Skill`,
    `UserPromptExpansion`), and `.mcp.json` only `mcp.expo.dev`. No configurable
    command exists.

### Task 4: Create the sibling repository

**Files:** Create: `plume-works/vscode-expo-bridge` on GitHub

- [x] The repository exists with an MIT license, a bun-managed TypeScript
  extension skeleton, and `package.json` declaring `plume-works` as publisher.
  - **Evidence:** `plume-works/vscode-expo-bridge` is public, and GitHub detects
    its license as `MIT`. Commit
    [`91b9bbf`](https://github.com/plume-works/vscode-expo-bridge/commit/91b9bbfd1f825527f68f6895a4a27865628ce477)
    on `main` adds `package.json` (`"publisher": "plume-works"`), `bun.lock`,
    `tsconfig.json` and `src/extension.ts`. `bun run typecheck`, `bun run build`
    and `bun run package` passed on it.

### Task 5: Spike a contained `eas build --local`

**Files:** none — a `sandbox-exec` profile driven by the Task 1 scratch
extension; its findings are recorded under `## Verification results`

- [x] A `postinstall` script added to the app that reads `~/.ssh` fails under
  the profile, and one that writes to `~/Library/LaunchAgents` fails.
  - **Evidence:** Spike builds on 2026-10-21 under a profile that allows by
    default, denies `file-write*` except `/dev`, `/private/tmp`, the user's
    `/private/var/folders/<id>`, the package and Xcode caches, and the output
    directory, and denies `file-read*` of `~/.ssh`, `~/.gnupg`, `~/.aws`,
    `~/.config/gh`, `~/Library/Keychains` and `~/.netrc`. In both
    `INSTALL_DEPENDENCIES` and `PREBUILD`, `ls ~/.ssh` and
    `touch ~/Library/LaunchAgents/<file>` failed with `Operation not permitted`.
    The profile is
    [`extensions/ui/sandbox.sb`](https://github.com/plume-works/agent-expo-bridge-spikes/blob/3409e51830b52545a8cfd911f2296423052a0617/extensions/ui/sandbox.sb)
    and the `postinstall` probe
    [`scratch-app/probe.sh`](https://github.com/plume-works/agent-expo-bridge-spikes/blob/3409e51830b52545a8cfd911f2296423052a0617/scratch-app/probe.sh)
    in plume-works/agent-expo-bridge-spikes.
- [x] When either check fails, it is recorded under `## Verification results`
  and the plan goes back to revise before Task 17.
  - **Evidence:** Commit `363370b` records the nested-sandbox failure under
    `## Verification results`.
- [x] When the build's inner tool sandboxes cannot be turned off for the build's
  process tree alone, it is recorded under `## Verification results` and the
  plan goes back to revise its containment before Task 17.
  - **Evidence:** Commit `2455170` records under `## Verification results` that
    the inner-sandbox override cannot be scoped to the build.

### Task 6: Spike what a container-side extension can do through VS Code commands

**Files:** none — an attacker workspace extension added beside the Task 1
scratch extension, in a Dev Containers window on a Mac

- [x] The attacker, a workspace extension other than the bridge's, invokes a
  command the `ui` side registers, and the handler receives nothing that
  identifies the calling extension or host.
  - **Evidence:** See `## Verification results` → "Task 6: a command invocation
    carries no caller identity", recorded in commit `267ac35`. Run 2026-10-21 on
    a macOS Dev Containers window. Spike: `callBridge` in
    [`plume-works/agent-expo-bridge-spikes extensions/attacker/extension.js`](https://github.com/plume-works/agent-expo-bridge-spikes/blob/3409e51830b52545a8cfd911f2296423052a0617/extensions/attacker/extension.js).
- [x] The attacker changes the workspace folders through
  `vscode.workspace.updateWorkspaceFolders`, and the `ui` side still resolves
  the window's original host path.
  - **Evidence:** See `## Verification results` → "Task 6", recorded in commit
    `267ac35`. Run 2026-10-21: after the injected folder the `ui` side resolved
    the original `dev-container+…` authority and host path. Spike: `swapFolders`
    in
    [`plume-works/agent-expo-bridge-spikes extensions/attacker/extension.js`](https://github.com/plume-works/agent-expo-bridge-spikes/blob/3409e51830b52545a8cfd911f2296423052a0617/extensions/attacker/extension.js).

### Task 7: Spike what the container reaches on the Mac without the bridge

**Files:** none — the Task 6 attacker extension and a container shell, in a Dev
Containers window on a Mac

- [x] The attacker opens a local terminal and sends it text
  (`workbench.action.terminal.newLocal`,
  `workbench.action.terminal.sendSequence`); whether a command runs on the Mac
  is recorded.
  - **Evidence:** See `## Verification results` → "Task 7: the window already
    grants the container host reach", recorded in commit `267ac35`. Run
    2026-10-21: the marker command ran on the Mac with no prompt. Spike:
    `localTerminalExec` in
    [`plume-works/agent-expo-bridge-spikes extensions/attacker/extension.js`](https://github.com/plume-works/agent-expo-bridge-spikes/blob/3409e51830b52545a8cfd911f2296423052a0617/extensions/attacker/extension.js).

### Task 8: Spike iOS Simulator containment

**Files:** none — the Task 1 scratch app with probes, on a Mac

- [x] An `.app` the container writes into `.tmp/expo-bridge/`, not produced by a
  build, installs and launches through `xcrun simctl`; the result is recorded.
  - **Evidence:** See `## Verification results` → "Task 8: a container-written
    `.app` installs and launches". Run 2026-10-21 on `robomac.local` via the
    bridge: an `.app` unpacked into `.tmp/` (path-validated under `.tmp/`)
    installed on the booted iPhone 17 Pro (`simctl install` exit 0) and launched
    (`simctl launch` exit 0), bundle id `dev.plumeworks.expobridgespike` read
    from its `Info.plist`. Spike: `task8_installProvidedApp` in
    [`plume-works/agent-expo-bridge-spikes extensions/ui/spikes.js`](https://github.com/plume-works/agent-expo-bridge-spikes/blob/3409e51830b52545a8cfd911f2296423052a0617/extensions/ui/spikes.js).

### Task 9: Spike the workspace file boundary

**Files:** none — the Task 1 scratch extension, on a Mac

- [x] From the `ui` side, Node's `fs.open` with `O_NOFOLLOW_ANY` (`0x20000000`)
  refuses a path with a symlink in any component, and with `O_CREAT | O_EXCL`
  creates a fresh file otherwise.
  - **Evidence:** See `## Verification results` → "Task 9: the workspace file
    boundary holds on macOS". Run 2026-10-21 on `robomac.local` via the spike
    bridge: a symlinked directory component and a final symlink both refused
    (`ELOOP`); fresh `O_CREAT|O_EXCL|O_NOFOLLOW_ANY` created, second create
    `EEXIST`. Spike: `task9_nofollow` in
    [`plume-works/agent-expo-bridge-spikes extensions/ui/spikes.js`](https://github.com/plume-works/agent-expo-bridge-spikes/blob/3409e51830b52545a8cfd911f2296423052a0617/extensions/ui/spikes.js).
- [x] Whether eas-cli writes through a symlink the container planted at the
  artifact's file name, or in place of `EAS_LOCAL_BUILD_ARTIFACTS_DIR`, is
  recorded.
  - **Evidence:** See `## Verification results` → "Task 9". Recorded: the host
    extension builds into private global storage and copies out under the
    fresh-write rule, so a planted symlink at the artifact name or artifacts dir
    is never followed. Spike: `task9_symlinkArtifactDir` in
    [`plume-works/agent-expo-bridge-spikes extensions/ui/spikes.js`](https://github.com/plume-works/agent-expo-bridge-spikes/blob/3409e51830b52545a8cfd911f2296423052a0617/extensions/ui/spikes.js).
- [x] Container-written `.tar.gz` archives holding an absolute path, a `..`
  entry, and a symlink followed by an entry through it, unpacked the way
  `install` will unpack them, write nothing outside a fresh directory.
  - **Evidence:** See `## Verification results` → "Task 9". Run 2026-10-21: `..`
    entry rejected by bsdtar (`Path contains '..'`), absolute entry's leading
    `/` stripped, symlink entry's write did not reach outside and the
    post-extract symlink scan catches it so `install` rejects the artifact.
    Spike: `task9_archives` in
    [`plume-works/agent-expo-bridge-spikes extensions/ui/spikes.js`](https://github.com/plume-works/agent-expo-bridge-spikes/blob/3409e51830b52545a8cfd911f2296423052a0617/extensions/ui/spikes.js).
- [x] Reading `eas.json` as a symlink, a FIFO, and an oversized file fails
  without blocking, and the returned error contains none of the file's bytes.
  - **Evidence:** See `## Verification results` → "Task 9". Run 2026-10-21: all
    three refused (symlink / not-regular / too-large), no blocking (the
    `O_NONBLOCK` open), no file bytes returned. Spike: `task9_configReads` in
    [`plume-works/agent-expo-bridge-spikes extensions/ui/spikes.js`](https://github.com/plume-works/agent-expo-bridge-spikes/blob/3409e51830b52545a8cfd911f2296423052a0617/extensions/ui/spikes.js).
- [x] Every failure is recorded under `## Verification results` and the plan
  goes back to revise before Task 11.
  - **Evidence:** All four Task 9 checks passed, recorded under
    `## Verification results` → "Task 9: the workspace file boundary holds on
    macOS"; nothing failed, so no revise is needed before Task 11.

### Task 10: Spike `eas build --local` tool versions and build reuse

**Files:** none — the Task 1 scratch app, on a Mac

- [x] Whether a build honors the `node`, `cocoapods`, `fastlane`, and `image`
  fields of `eas.json` is recorded from the tool versions the build log reports.
  - **Evidence:** See `## Verification results` → "Task 10". eas-cli 25.3.0
    rejects `cocoapods`, `fastlane`, `image` at schema validation; a build with
    `"node": "20.18.0"` logged the Node.js-mismatch warning and built with the
    Mac's Node, exit 0. Spike: `task10_toolVersions` in
    [`plume-works/agent-expo-bridge-spikes extensions/ui/spikes.js`](https://github.com/plume-works/agent-expo-bridge-spikes/blob/3409e51830b52545a8cfd911f2296423052a0617/extensions/ui/spikes.js).
- [x] Whether a second build of the unchanged app reuses anything from the first
  — dependency install, pods, DerivedData — is recorded.
  - **Evidence:** See `## Verification results` → "Task 10". Two consecutive
    builds (both exit 0) each ran in a fresh `eas-build-local-nodejs/<uuid>`
    workdir and installed all 443 packages (929 ms, then 529 ms from bun's
    cache) and all 103 pods. Spike: `task10_reuse` in
    [`plume-works/agent-expo-bridge-spikes extensions/ui/spikes.js`](https://github.com/plume-works/agent-expo-bridge-spikes/blob/3409e51830b52545a8cfd911f2296423052a0617/extensions/ui/spikes.js).
- [x] The results are recorded under `## Verification results`; when a field is
  honored, `status`'s tool checks are revised before Task 11.
  - **Evidence:** See `## Verification results` → "Task 10: cocoapods, fastlane,
    and image are not eas.json build fields". No field is honored, so `status`
    keeps probing the Mac's `node`, `pod`, and `fastlane` directly
    (`packages/host/src/status.ts`); no revision needed.

### Task 11: Specify the protocol and security model in the sibling repository

**Files:** Create: `docs/protocol.md` in `plume-works/vscode-expo-bridge`

- [x] It defines the five actions, their arguments and validation, the result
  and error shapes, workspace-relative paths and the symlink rule, the
  `.tmp/expo-bridge/` write boundary, the protocol version and how `status`
  reports a mismatch, and that fixes are never protocol actions.
  - **Evidence:** `plume-works/vscode-expo-bridge` commit
    [`5e7ab94`](https://github.com/plume-works/vscode-expo-bridge/commit/5e7ab94e922212321ac2121765f222114124d237)
    adds `docs/protocol.md` with `## Actions`,
    `## Paths and the write boundary`, `## Errors`, `## eas-host`, and
    `## Fixes are not protocol actions`. The mismatch it specifies is
    implemented in
    [`b288ec8`](https://github.com/plume-works/vscode-expo-bridge/commit/b288ec8e2a3ea059d42d8cff2126df5c80154756):
    `eas-host status` exits 3 naming both versions, covered by
    `packages/workspace/test/eas-host.test.ts`; `bun test` 112 pass / 0 fail.
- [x] It states that the bridge is a consent surface, not a security boundary,
  and names the trust prompt and the build confirmation the host extension
  implements.
  - **Evidence:** `docs/protocol.md` `## Security model` in commit
    [`5e7ab94`](https://github.com/plume-works/vscode-expo-bridge/commit/5e7ab94e922212321ac2121765f222114124d237)
    states the bridge is "a consent surface for a cooperative container, not a
    security boundary" and names the per-workspace trust modal and the per-build
    confirmation with its three answers.

### Task 12: Split the repository into the two extensions and the pack

**Files:** Modify: the skeleton in `plume-works/vscode-expo-bridge`

- [x] The repository builds `plume-works.vscode-expo-bridge-host`
  (`extensionKind: ["ui"]`), `plume-works.vscode-expo-bridge-workspace`
  (`extensionKind: ["workspace"]`), and the pack
  `plume-works.vscode-expo-bridge` listing both, each packaged as a VSIX.
  - **Evidence:** `plume-works/vscode-expo-bridge` commit
    [`8efc942`](https://github.com/plume-works/vscode-expo-bridge/commit/8efc942b76e5fcf2f28458f20abc79b8d10eab9b)
    (monorepo + protocol/host core) and
    [`1a40f27`](https://github.com/plume-works/vscode-expo-bridge/commit/1a40f27c8ba25173f0e967fbf72f9aca769e13f1)
    (host wiring, workspace extension, pack, CI), branch
    `expo-bridge-extensions`. `bun run package` produced
    `vscode-expo-bridge-host.vsix`, `vscode-expo-bridge-workspace.vsix`, and
    `vscode-expo-bridge.vsix`, with the two extensions carrying `extensionKind`
    `["ui"]` and `["workspace"]` and the pack's `extensionPack` listing both.

### Task 13: Workspace extension and `eas-host`

**Files:** Create: in `plume-works/vscode-expo-bridge`

- [x] The workspace extension activates on `workspaceContains:eas.json`,
  installs `eas-host` into `~/.local/bin`, and serves
  `/tmp/vscode-expo-bridge.sock`.
  - **Evidence:** Commit
    [`1a40f27`](https://github.com/plume-works/vscode-expo-bridge/commit/1a40f27c8ba25173f0e967fbf72f9aca769e13f1).
    `packages/workspace/package.json` sets
    `activationEvents: ["workspaceContains:eas.json"]`;
    `packages/workspace/src/extension.ts` writes an `eas-host` launcher into
    `~/.local/bin` on activation and listens on `SOCKET_PATH`
    (`/tmp/vscode-expo-bridge.sock`).
- [x] `eas-host` maps each action to one socket request, streams the build log,
  prints the result as JSON, and exits non-zero when the bridge is unavailable
  or the action fails.
  - **Evidence:** Commit
    [`1a40f27`](https://github.com/plume-works/vscode-expo-bridge/commit/1a40f27c8ba25173f0e967fbf72f9aca769e13f1).
    `packages/workspace/bin/eas-host.ts` sends one request per action over the
    socket, prints log frames to stderr and the result JSON to stdout, and exits
    0/1/2/3 (success / action failed / usage / unavailable). The end-to-end CLI
    test in `packages/workspace/test/eas-host.test.ts` drives a real local
    socket and covers success, unavailable (exit 3), action failure (exit 1),
    and log streaming.
- [x] `bun test` covers argument handling, the unavailable path, and log
  streaming.
  - **Evidence:** Commit
    [`1a40f27`](https://github.com/plume-works/vscode-expo-bridge/commit/1a40f27c8ba25173f0e967fbf72f9aca769e13f1).
    `packages/workspace/test/cli-args.test.ts` covers argument handling for
    every action, `test/wire.test.ts` covers the newline-framed decoder and the
    log-then-response stream shape, and `test/eas-host.test.ts` covers the
    no-socket unavailable path and build-log streaming end to end. `bun test`
    reports 99 pass / 0 fail across 14 files.

### Task 14: Host extension — environment, processes, and paths

**Files:** Create: in `plume-works/vscode-expo-bridge`

- [x] The host extension captures the login environment with
  `$SHELL -l -c 'env -0'`, resolves tools through it plus `/opt/homebrew/bin`
  and `/usr/local/bin`, and starts every process with `execFile` and an argument
  array.
  - **Evidence:** Commit
    [`8efc942`](https://github.com/plume-works/vscode-expo-bridge/commit/8efc942b76e5fcf2f28458f20abc79b8d10eab9b).
    `packages/host/src/env.ts` (`captureLoginEnv` runs `$SHELL -l -c 'env -0'`,
    `withHomebrewPath` prepends the two prefixes, `lookupTool` resolves against
    PATH) and `packages/host/src/exec.ts` (`run` uses `execFile` with an
    argument array, never a shell string). `test/env.test.ts` covers fish and
    POSIX dumps, the Homebrew prepend, and lookup. The real-shell `env -0`
    capture was confirmed on the Mac in Task 2.
- [x] A protocol path is rejected when any component is a symlink or its
  `realpath` leaves the workspace, and every write under `.tmp/expo-bridge/`
  uses a fresh name with `O_CREAT | O_EXCL | O_NOFOLLOW_ANY`.
  - **Evidence:** Commit
    [`8efc942`](https://github.com/plume-works/vscode-expo-bridge/commit/8efc942b76e5fcf2f28458f20abc79b8d10eab9b).
    `packages/host/src/paths.ts`: `resolveWithin` walks every component with
    `lstat` and rejects a symlinked component or a `realpath` that leaves the
    workspace; `openFreshWrite` opens with
    `O_CREAT | O_EXCL | O_WRONLY | O_NOFOLLOW_ANY`. `test/paths.test.ts` proves
    symlink-component rejection, the `..` escape, not-found, and that a second
    create fails (O_EXCL), and asserts the flag bits. The macOS kernel
    enforcement of `O_NOFOLLOW_ANY` itself is confirmed by plan Task 9.
- [x] `eas.json` and `app.json` are read as JSON only, refusing a symlink, a
  non-regular file, or an oversized file, with errors that quote no file
  contents.
  - **Evidence:** Commit
    [`8efc942`](https://github.com/plume-works/vscode-expo-bridge/commit/8efc942b76e5fcf2f28458f20abc79b8d10eab9b).
    `packages/host/src/jsonfile.ts` (`readJsonFile` lstat-rejects a symlink,
    opens `O_NOFOLLOW|O_NONBLOCK`, fstat-rejects a non-regular file and an
    oversized one, and throws messages with no file bytes).
    `test/jsonfile.test.ts` covers a symlink, a FIFO, an oversized file, and a
    parse error whose message excludes a planted secret.
- [x] `bun test` covers environment parsing for fish and POSIX shells, tool
  lookup, path rejection for symlinks and `..`, the write flags, and the file
  read refusals.
  - **Evidence:** Commit
    [`8efc942`](https://github.com/plume-works/vscode-expo-bridge/commit/8efc942b76e5fcf2f28458f20abc79b8d10eab9b).
    `test/env.test.ts`, `test/paths.test.ts`, and `test/jsonfile.test.ts` cover
    every named area; `bun test` reports 99 pass / 0 fail across 14 files.

### Task 15: Host extension — trust, build confirmation, and the token

**Files:** Create: in `plume-works/vscode-expo-bridge`

- [x] The first request from an untrusted workspace prompts for trust, recorded
  in `globalState` by host path; a declined workspace fails every request until
  a command revokes the decision; a command lists and revokes trusted
  workspaces.
  - **Evidence:** Commits
    [`8efc942`](https://github.com/plume-works/vscode-expo-bridge/commit/8efc942b76e5fcf2f28458f20abc79b8d10eab9b)/[`1a40f27`](https://github.com/plume-works/vscode-expo-bridge/commit/1a40f27c8ba25173f0e967fbf72f9aca769e13f1).
    `packages/host/src/trust.ts` (`TrustStore.ensureTrusted` prompts once and
    records the decision in `globalState` keyed by host path; a declined
    workspace stays declined until `revoke`; `listTrusted`/`revoke` back the
    manage-trust command). `test/trust.test.ts` covers prompt-once, remembered
    allow, sticky decline, and revocation.
- [x] Each `build` prompts with "Allow once", "Allow and don't ask for an hour",
  and "Allow and don't ask today", and a cooldown suppresses the prompt for that
  workspace only until it expires.
  - **Evidence:** Commits
    [`8efc942`](https://github.com/plume-works/vscode-expo-bridge/commit/8efc942b76e5fcf2f28458f20abc79b8d10eab9b)/[`1a40f27`](https://github.com/plume-works/vscode-expo-bridge/commit/1a40f27c8ba25173f0e967fbf72f9aca769e13f1).
    `TrustStore.confirmBuild` and the build prompt in
    `packages/host/src/extension.ts` offer the three answers; "once" records no
    cooldown, "hour"/"today" record one scoped to the host path.
    `test/trust.test.ts` covers the hour cooldown's expiry, that "once"
    re-prompts, per-workspace scoping, and decline. The labels are
    `BUILD_ANSWERS` in `packages/host/src/trust.ts` since `main` at
    [`c74f295`](https://github.com/plume-works/vscode-expo-bridge/commit/c74f295)
    ([PR #10](https://github.com/plume-works/vscode-expo-bridge/pull/10)),
    asserted in `test/trust.test.ts`.
- [x] Commands set and clear `EXPO_TOKEN` in SecretStorage, and the README
  recommends a robot-account token scoped to the project.
  - **Evidence:** Commit
    [`1a40f27`](https://github.com/plume-works/vscode-expo-bridge/commit/1a40f27c8ba25173f0e967fbf72f9aca769e13f1).
    `expoBridge.setToken`/`clearToken` in `packages/host/src/extension.ts` store
    and delete the token through `TrustStore` SecretStorage;
    `test/trust.test.ts` covers set/get/clear. `packages/host/README.md`
    recommends a project-scoped robot-account token.
- [x] The trust, token, and fix commands take no arguments, return nothing, and
  change nothing until the user answers a modal.
  - **Evidence:** Commit
    [`1a40f27`](https://github.com/plume-works/vscode-expo-bridge/commit/1a40f27c8ba25173f0e967fbf72f9aca769e13f1).
    The four command handlers in `packages/host/src/extension.ts` (`setToken`,
    `clearToken`, `manageTrust`, `fix`) take no arguments and act only after
    `showWarningMessage`/ `showInputBox`/`showQuickPick` returns the user's
    choice.
- [x] `bun test` covers trust grant, decline, and revocation, each cooldown's
  expiry, and per-workspace scoping, with the clock and prompts stubbed.
  - **Evidence:** Commit
    [`8efc942`](https://github.com/plume-works/vscode-expo-bridge/commit/8efc942b76e5fcf2f28458f20abc79b8d10eab9b).
    `test/trust.test.ts` stubs the clock and the prompts and covers grant,
    decline, revocation, the hour cooldown expiry, the end-of-day path, and
    per-workspace scoping.

### Task 16: Host extension — `status`

**Files:** Create: in `plume-works/vscode-expo-bridge`

- [x] `status` reports every check in `## Approach`, and reports unavailable on
  a non-Mac host and when the workspace host path does not exist locally.
  - **Evidence:** Commit
    [`8efc942`](https://github.com/plume-works/vscode-expo-bridge/commit/8efc942b76e5fcf2f28458f20abc79b8d10eab9b).
    `packages/host/src/status.ts` reports all twelve checks (Mac host, host
    path, trust, Xcode, CocoaPods, fastlane, Node, bun vs. the container's,
    EXPO_TOKEN, `extra.eas.projectId`, booted simulator, port 8081) plus the
    protocol version, and sets `available: false` on a non-Mac host or a missing
    host path, skipping the tool probes.
- [x] `bun test` covers each check's pass and fail result with the system probes
  stubbed.
  - **Evidence:** Commit
    [`8efc942`](https://github.com/plume-works/vscode-expo-bridge/commit/8efc942b76e5fcf2f28458f20abc79b8d10eab9b).
    `test/status.test.ts` stubs the runner and `fileExists` and covers
    all-green, non-Mac, missing host path, each tool absence, an older Mac bun,
    no booted simulator, missing projectId, missing token, unforwarded port, and
    an untrusted workspace.

### Task 17: Host extension — `build`

**Files:** Create: in `plume-works/vscode-expo-bridge`

- [x] `build` rejects a profile absent from `eas.json`, requires trust and the
  build confirmation, and runs `eas build --local -p ios --profile <name>` with
  the login environment plus `EXPO_TOKEN` from SecretStorage, `EAS_NO_VCS=1`,
  and the artifact built into the host extension's global storage, then copied
  with the log into `.tmp/expo-bridge/` under the write rule. `build` returns
  the artifact's workspace-relative path and the exit code, and never runs
  `eas init`.
  - **Evidence:** Commits
    [`8efc942`](https://github.com/plume-works/vscode-expo-bridge/commit/8efc942b76e5fcf2f28458f20abc79b8d10eab9b)/[`1a40f27`](https://github.com/plume-works/vscode-expo-bridge/commit/1a40f27c8ba25173f0e967fbf72f9aca769e13f1).
    `packages/host/src/build.ts` validates the profile against `eas.json`, runs
    `eas build --local --non-interactive -p ios --profile <name>` with the login
    env plus `EXPO_TOKEN`, `EAS_NO_VCS=1`, and `EAS_LOCAL_BUILD_ARTIFACTS_DIR`
    in private global storage, then copies the artifact and log into
    `.tmp/expo-bridge/` through `openFreshWrite`, returns the workspace-relative
    path and exit code, and never passes an `init` invocation; `src/dispatch.ts`
    gates trust and the confirmation before it runs. The real
    `eas build --local` behavior (env, no-VCS packing, artifact) was confirmed
    on the Mac in plan Task 2.
- [x] `bun test` covers profile validation, the gating order, and the `eas`
  arguments and environment, with process spawning stubbed.
  - **Evidence:** Commit
    [`8efc942`](https://github.com/plume-works/vscode-expo-bridge/commit/8efc942b76e5fcf2f28458f20abc79b8d10eab9b)/[`1a40f27`](https://github.com/plume-works/vscode-expo-bridge/commit/1a40f27c8ba25173f0e967fbf72f9aca769e13f1).
    `test/build.test.ts` stubs the runner and covers unknown-profile rejection,
    invalid profile names, unconfirmed builds, the exact `eas` argument array,
    env (`EAS_NO_VCS`, `EXPO_TOKEN` present/absent, artifacts dir), absence of
    any `init` invocation, the copied paths, and a non-zero exit;
    `test/dispatch.test.ts` covers the trust/confirmation gating order.

### Task 18: Host extension — `install`, `launch`, `screenshot`

**Files:** Create: in `plume-works/vscode-expo-bridge`

- [x] `install` rejects a path outside `.tmp/expo-bridge/`, unpacks the artifact
  into a fresh private directory rejecting absolute, `..`, and symlink entries,
  and installs it on the booted simulator; `launch` starts the app `install`
  last installed, by the `CFBundleIdentifier` in its `Info.plist`; `screenshot`
  writes a PNG under `.tmp/expo-bridge/` and returns its workspace-relative
  path.
  - **Evidence:** Commit
    [`95037d4`](https://github.com/plume-works/vscode-expo-bridge/commit/95037d45be8347af51e542b469a844b4b7fd4017).
    `packages/host/src/install.ts`: `install` resolves the path with
    `requireUnderWriteDir`, unpacks with `tar -xk` into a fresh global-storage
    directory and rejects any symlink in the tree, reads the binary
    `Info.plist`'s `CFBundleIdentifier` through `plutil -convert json`, and runs
    `simctl install booted`; `launch` runs `simctl launch booted <id>`;
    `screenshot` captures into private storage and copies the PNG into
    `.tmp/expo-bridge/` with `copyFresh`. The bsdtar entry handling and a
    container-written `.app` installing and launching were confirmed on the Mac
    by Tasks 8 and 9.
- [x] `bun test` covers path validation, archive entry rejection, and the
  `xcrun simctl` invocations.
  - **Evidence:** Commit
    [`95037d4`](https://github.com/plume-works/vscode-expo-bridge/commit/95037d45be8347af51e542b469a844b4b7fd4017).
    `packages/host/test/install.test.ts` stubs the runner and covers the
    path-outside-write-dir rejection, the post-unpack symlink rejection, the
    `plutil` read of a binary `Info.plist`, a malformed bundle id, the
    `simctl install`/`launch`/`io screenshot` invocations, and that a failed
    capture writes nothing; `test/tar.test.ts` covers absolute, `..`, symlink,
    and hard-link entries. `bun test` 112 pass / 0 fail.

### Task 19: One-click fix

**Files:** Create: in `plume-works/vscode-expo-bridge`

- [x] For each failing `status` check that a tool install resolves, the VS Code
  UI offers a fix that runs the Homebrew command in a visible local terminal;
  for Xcode it opens the App Store page and then runs `xcode-select`, the
  license acceptance, and `xcodebuild -downloadPlatform iOS`.
  - **Evidence:** Commit
    [`b0e473f`](https://github.com/plume-works/vscode-expo-bridge/commit/b0e473f30dfe9eedf4ae5ea6ff0efc34d34ae9ac).
    After a `status` with a fixable failure, `offerFixes` in
    `packages/host/src/extension.ts` shows a notification whose **Fix…** button
    runs `expoBridge.fix`, which opens a terminal from the `ui` host and sends
    the chosen step's commands. `planFixes` in `packages/host/src/fix.ts` maps
    CocoaPods, fastlane, Node, and bun to Homebrew installs and Xcode to the App
    Store page followed by `xcode-select`, `xcodebuild -license accept`, and
    `xcodebuild -downloadPlatform iOS`; `test/fix.test.ts` covers each. The
    Xcode check now requires `xcodebuild -version` to succeed
    (`test/status.test.ts`).
- [x] No protocol action can start a fix.
  - **Evidence:** Commit
    [`1a40f27`](https://github.com/plume-works/vscode-expo-bridge/commit/1a40f27c8ba25173f0e967fbf72f9aca769e13f1).
    The fix lives only in the `expoBridge.fix` VS Code command handler in
    `packages/host/src/extension.ts`, reached by a user click.
    `packages/host/src/dispatch.ts` routes only the five protocol actions
    (`status`, `build`, `install`, `launch`, `screenshot`) and has no path to
    `planFixes` or a terminal; `test/dispatch.test.ts` confirms an unknown
    action is rejected as `bad-request`.

### Task 20: Sibling repository CI

**Files:** Create: `.github/workflows/` in `plume-works/vscode-expo-bridge`

- [x] A workflow runs lint, `bun test`, and the three VSIX package builds on
  every pull request, and passes on `main`.
  - **Evidence:** `.github/workflows/ci.yml` runs on `pull_request` and on push
    to `main`: Prettier lint (added in
    [`32c704a`](https://github.com/plume-works/vscode-expo-bridge/commit/32c704a)),
    typecheck, `bun test`, and the three VSIX builds. It passed on [PR
    #1](https://github.com/plume-works/vscode-expo-bridge/pull/1) and, after the
    squash merge
    [`4f2d7dd`](https://github.com/plume-works/vscode-expo-bridge/commit/4f2d7dd823d370500495eae7ad57b8cc5f955a38),
    on `main` in [run
    39698880522](https://github.com/plume-works/vscode-expo-bridge/actions/runs/39698880522).

### Task 20b: Host extension — boot a simulator on demand

**Files:** Modify: `packages/host/src/install.ts`,
`packages/host/src/status.ts`, `packages/protocol/src/index.ts`,
`docs/protocol.md` in `plume-works/vscode-expo-bridge`

- [x] With no simulator booted, `install`, `launch`, and `screenshot` boot an
  available iPhone on the newest available iOS runtime, creating one when none
  exists, and wait for the boot to finish; with one booted they boot nothing.
  - **Evidence:** `plume-works/vscode-expo-bridge` commit
    [`7405fd7`](https://github.com/plume-works/vscode-expo-bridge/commit/7405fd7)
    ([PR #2](https://github.com/plume-works/vscode-expo-bridge/pull/2)):
    `ensureBooted` in `packages/host/src/simulator.ts` reuses a booted device,
    else boots an iPhone on the newest iOS runtime or creates one, and waits
    with `simctl bootstatus <udid> -b`; `packages/host/src/install.ts` routes
    `install`, `launch`, and `screenshot` through it by UDID.
- [x] `status` replaces `bootedSimulator` with `simulator`, which passes when a
  simulator is booted or an iOS runtime is available to boot one, and
  `docs/protocol.md` describes both.
  - **Evidence:** Commit
    [`7405fd7`](https://github.com/plume-works/vscode-expo-bridge/commit/7405fd7):
    `simulatorCheck` in `packages/host/src/status.ts` reports `simulator` from
    the read-only `planBoot`, the protocol type renames the check, and
    `docs/protocol.md` gains `### The simulator` and the `simulator` check.
- [x] `bun test` covers an already-booted simulator, reusing a shut-down iPhone,
  creating one, no available iOS runtime, a failed boot, and the `simulator`
  check, with `simctl` stubbed.
  - **Evidence:** Commit
    [`7405fd7`](https://github.com/plume-works/vscode-expo-bridge/commit/7405fd7):
    `packages/host/test/simulator.test.ts` covers each case plus a failed
    create, `test/status.test.ts` the bootable and no-runtime `simulator`
    results, and `test/install.test.ts` the UDID targeting; `bun test` 122 pass
    / 0 fail.

### Task 20c: Host extension — pinned eas-cli and a fix that sees the container's bun

**Files:** Create: `packages/host/src/eascli.ts`; Modify:
`packages/host/src/build.ts`, `packages/host/src/status.ts`,
`packages/host/src/extension.ts`, `packages/protocol/src/index.ts`,
`docs/protocol.md` in `plume-works/vscode-expo-bridge`

- [x] `build` runs `bunx eas-cli@<spec>` with the Mac's bun, `<spec>` taken from
  `cli.version` in the workspace `eas.json` or `latest`, and refuses a value
  that is not a semver version or range; `status` reports the spec as an
  `easCli` check that fails only on a refused value.
  - **Evidence:** `plume-works/vscode-expo-bridge` `main` at
    [`a6c6574`](https://github.com/plume-works/vscode-expo-bridge/commit/a6c6574)
    ([PR #9](https://github.com/plume-works/vscode-expo-bridge/pull/9)):
    `easCliSpec` and `normalizeRange` in `packages/host/src/eascli.ts`, the
    `bun x eas-cli@<spec>` invocation in `packages/host/src/build.ts`,
    `easCliCheck` in `packages/host/src/status.ts`, and `docs/protocol.md`
    `### build`. On the Mac a pinned `eas-cli@25.3.0` built the scratch app
    through `bunx`, exit 0.
- [x] The fix command plans its steps against the container bun version of the
  last `status` request, so a Mac bun older than the container's is offered as a
  fix.
  - **Evidence:** `plume-works/vscode-expo-bridge` `main` at
    [`bd3faae`](https://github.com/plume-works/vscode-expo-bridge/commit/bd3faae)
    (`lastContainerBunVersion` in `packages/host/src/extension.ts`). On the Mac,
    after `eas-host status` sent a container bun `99.0.0`, **Fix…** opened the
    picker listing "Install or update bun" where the previous build showed
    "nothing to fix".
- [x] `bun test` covers spec selection, accepted ranges, refused specs, the
  `build` invocation and refusal, and the `easCli` check.
  - **Evidence:** `main` at
    [`a6c6574`](https://github.com/plume-works/vscode-expo-bridge/commit/a6c6574):
    `packages/host/test/eascli.test.ts` covers versions, `^`/`~`/`x`/`*`,
    comparator, `||`, and hyphen ranges with operator spaces removed, refused
    `file:`/git/URL/alias/tag and non-string values, an unset `cli.version`, an
    ignored `package.json` entry, and a symlinked `eas.json`;
    `test/build.test.ts` covers the pinned invocation and the refusal;
    `test/status.test.ts` the `easCli` results. `bun test` 168 pass / 0 fail.

### Task 20d: Host extension — a lasting fix surface and a launch that loads Metro

**Files:** Modify: `packages/host/src/extension.ts`, `packages/host/src/fix.ts`,
`packages/host/src/install.ts`, `docs/protocol.md` in
`plume-works/vscode-expo-bridge`

- [x] After a `status` with a fixable failure, a status bar item names the
  number of fixes and stays until a later `status` has none; clicking it opens
  the fix picker, which stays open on focus loss and shows each failing check's
  detail. While a fix runs, the item shows it running and starts no other; when
  the fix's commands finish or its terminal closes, the host re-runs `status`. A
  notification with a **Fix…** button also appears whenever the set of failing
  checks changes, and no text calls an outdated tool missing.
  - **Evidence:** `plume-works/vscode-expo-bridge` `main` at
    [`5fd9902`](https://github.com/plume-works/vscode-expo-bridge/commit/5fd9902)
    (`showFixes`, `FixGate`, and `FixNotices` in `packages/host/src`,
    unit-tested in `test/fix.test.ts` and `test/fixrun.test.ts`). Run on
    2026-10-23 on the Mac with VSIX 0.1.7: after a `status` with a container bun
    `99.0.0`, the notification "Install or update bun (Mac bun 1.4.3 is older
    than the container's 99.0.0)" and "Expo Bridge: 1 fix" appeared; the
    picker's fix ran in a Mac terminal while the item showed "fixing…"; the next
    plain `eas-host status` reported `bun` ok and the item disappeared.
- [x] `install` records whether the app is a development build, by an `exp+…`
  URL scheme in its `Info.plist`, and `launch` restarts a development build with
  `simctl launch --terminate-running-process <udid> <bundle id> --initialUrl http://localhost:8081`,
  launching any other app without the argument. No URL is opened through
  `simctl openurl`, which iOS answers with an "Open in" prompt.
  - **Evidence:** `plume-works/vscode-expo-bridge` commit
    [`f7f276c`](https://github.com/plume-works/vscode-expo-bridge/commit/f7f276c)
    ([PR #6](https://github.com/plume-works/vscode-expo-bridge/pull/6)):
    `launch` in `packages/host/src/install.ts` and `docs/protocol.md`
    `### launch`. On the Mac, `simctl launch` of the scratch development build
    with `--initialUrl http://localhost:8081` loaded the bundle from the
    container's Metro ("Bundling 99%…", then the app) with no launcher or tap,
    where the `openurl` deep link stopped at "Open in 'app'?".
- [x] A development build's launch also passes
  `-EXDevMenuIsOnboardingFinished YES` and `-EXDevMenuShowsAtLaunch NO`, so
  neither expo-dev-menu's introduction nor the menu covers the app after it
  loads.
  - **Evidence:** `plume-works/vscode-expo-bridge` `main` at
    [`ac70320`](https://github.com/plume-works/vscode-expo-bridge/commit/ac70320)
    ([PR #7](https://github.com/plume-works/vscode-expo-bridge/pull/7)):
    `DEV_MENU_QUIET` in `packages/host/src/install.ts`, asserted in
    `test/install.test.ts`. On the Mac, after `simctl uninstall` of the scratch
    app, the 0.1.3 build's `eas-host install` and `launch` showed "Open up
    App.js to start working on your app!" with no introduction or menu.
- [x] `bun test` covers the scheme read, a scheme that is not `exp+` plus a safe
  name, the development-build and plain launches, and the fix item text.
  - **Evidence:** Commits
    [`907b501`](https://github.com/plume-works/vscode-expo-bridge/commit/907b501)
    and
    [`f7f276c`](https://github.com/plume-works/vscode-expo-bridge/commit/f7f276c):
    `packages/host/test/install.test.ts` covers the recorded scheme, the refused
    `exp+evil://…` and bare `exp+`, the exact `--initialUrl` launch with no
    `openurl`, and the plain launch; `test/fix.test.ts` covers `fixSummary`'s
    count, tooltip details, and that no text says "missing". `bun test` 162 pass
    / 0 fail.

### Task 20e: Host extension — end a build cooldown without revoking trust

**Files:** Modify: `packages/host/src/trust.ts`,
`packages/host/src/extension.ts`, `packages/host/package.json`,
`docs/protocol.md` in `plume-works/vscode-expo-bridge`

- [x] **Expo Bridge: Ask Before Every Build** takes no arguments, asks in a
  modal, then ends the window's workspace cooldown so its next build confirms
  again, leaving trust unchanged; with no live cooldown it changes nothing.
  - **Evidence:** `plume-works/vscode-expo-bridge` `main` at
    [`5fd9902`](https://github.com/plume-works/vscode-expo-bridge/commit/5fd9902)
    (`expoBridge.askBeforeEveryBuild` in `packages/host/src/extension.ts`). Run
    on 2026-10-23 on the Mac with VSIX 0.1.7: after "Allow and don't ask" on a
    build, running the command and confirming made the next
    `eas-host build development` show the build confirmation again with no trust
    prompt, between both completed and interrupted builds.
- [x] `bun test` covers ending a cooldown with trust kept, per-workspace
  scoping, and an expired cooldown.
  - **Evidence:** `plume-works/vscode-expo-bridge` `main` at
    [`5fd9902`](https://github.com/plume-works/vscode-expo-bridge/commit/5fd9902)
    ([PR #12](https://github.com/plume-works/vscode-expo-bridge/pull/12)):
    `hasCooldown` and `clearCooldown` in `packages/host/src/trust.ts`, covered
    by `test/trust.test.ts` `describe("clearCooldown")`; `bun test` 174 pass / 0
    fail.

### Task 21: Local test on a Mac from the packaged VSIX files

**Files:** none — the `vscode-expo-bridge-host.vsix` and
`vscode-expo-bridge-workspace.vsix` that `bun run package` builds from a commit
on `main` of `plume-works/vscode-expo-bridge`, and a scratch Expo app with an
`eas.json` simulator profile and a linked EAS project, on a Mac

- [x] With the host VSIX installed in VS Code on the Mac and the workspace VSIX
  installed into the container of a Dev Containers window on the scratch app,
  the Extensions view shows the host extension as local and the workspace
  extension in the container, and `eas-host` is on the container's `PATH`.
  - **Evidence:** Run on 2026-10-23 on the Mac with VSIX 0.1.7 from
    `plume-works/vscode-expo-bridge` `main` at
    [`5fd9902`](https://github.com/plume-works/vscode-expo-bridge/commit/5fd9902):
    the Extensions view listed `plume-works.vscode-expo-bridge-host` 0.1.7 in
    the local extension host and `plume-works.vscode-expo-bridge-workspace`
    0.1.7 as "enabled on 'Dev Container: expo-bridge-t21'", both from VSIX;
    `which eas-host` in that container printed `/home/node/.local/bin/eas-host`.
- [x] From that window an agent runs `eas-host status`, `build` for the
  simulator profile, `install`, `launch`, and `screenshot`, and reads the
  screenshot from the container; the trust prompt appears on the first request
  and the build confirmation on `build`.
  - **Evidence:** Run on 2026-10-23 on the Mac with VSIX 0.1.7 built from
    `plume-works/vscode-expo-bridge` `main` at
    [`5fd9902`](https://github.com/plume-works/vscode-expo-bridge/commit/5fd9902),
    in the container of the scratch app's Dev Containers window, after its trust
    was revoked: the first `eas-host status` raised the trust prompt and
    `eas-host build development` the build confirmation; `build` (eas-cli 25.3.0
    from `eas.json` `cli.version`), `install`, `launch`, and `screenshot` each
    exited 0, and the screenshot read from `.tmp/expo-bridge/` showed the app.
    The sequence ran from a script in that window, not an agent.
- [x] With Metro running in the container, the launched development build loads
  the JavaScript bundle over forwarded port 8081.
  - **Evidence:** Run on 2026-10-22 on the Mac with VSIX 0.1.3 built from
    `plume-works/vscode-expo-bridge` `main` at
    [`21277a7`](https://github.com/plume-works/vscode-expo-bridge/commit/21277a7):
    after `eas-host launch`, Metro in the container logged
    `iOS Bundled 398ms index.js (712 modules)` and `eas-host screenshot` showed
    the app's "Open up App.js to start working on your app!" screen.
- [x] A `status` with a fixable failing check offers **Fix…**, which opens a
  terminal on the Mac holding that check's Homebrew command.
  - **Evidence:** Same run: after `eas-host status` sent a container bun
    `99.0.0`, the status bar showed "Expo Bridge: 1 fix"; picking "Install or
    update bun" opened an "Expo Bridge fix" terminal marked "This shell is
    running on your local machine", which ran `brew install oven-sh/bun/bun` on
    `robomac`.
- [x] Before Task 22 tags the first pre-release, the second and third boxes'
  action sequence and Metro load pass again on the Mac from the host and
  workspace VSIX built from the commit that tag points at.
  - **Evidence:** Run on 2026-10-23 on the Mac with host and workspace VSIX
    0.1.10 built from `plume-works/vscode-expo-bridge` `main` at
    [`f0644d7`](https://github.com/plume-works/vscode-expo-bridge/commit/f0644d7),
    the commit the tag `v0.1.10` points at; `code --list-extensions` listed
    `plume-works.vscode-expo-bridge-host@0.1.10` on the Mac and
    `plume-works.vscode-expo-bridge-workspace@0.1.10` in the container. After
    the app was uninstalled from the simulator, `build` (eas-cli 25.3.0),
    `install`, `launch`, and `screenshot` exited 0, Metro logged
    `iOS Bundled 404ms index.js (693 modules)`, and the screenshot showed the
    app's "Open up App.js to start working on your app!" screen.

### Task 21b: Release workflow in the sibling repository

**Files:** Create: `.github/workflows/release.yml`,
`.github/workflows/marketplace-identity.yml`, and a tag and channel check under
`packages/release/` with its tests; Modify: the root `package.json` in
`plume-works/vscode-expo-bridge`

- [x] The release check fails unless the tag equals `v` plus the shared version
  of the three extension `package.json` files, and reports a pre-release for an
  odd minor and a release for an even one; `bun test` covers both.
  - **Evidence:**
    [`48467e9`](https://github.com/plume-works/vscode-expo-bridge/commit/48467e9)
    on `plume-works/vscode-expo-bridge` `main` adds
    `packages/release/src/release.ts` (`checkTag`, `channelOf`) and
    `packages/release/test/release.test.ts`; `bun test` passes 183 tests.
- [x] A `vX.Y.Z` tag push runs `release.yml`, whose build job installs with
  `--frozen-lockfile`, lints, typechecks, tests, runs the release check,
  packages the three VSIX — with `--pre-release` when the minor is odd — and
  uploads them as artifacts.
  - **Evidence:** The tag `v0.1.10` on `f0644d7` started `release.yml` [run
    39903090857](https://github.com/plume-works/vscode-expo-bridge/actions/runs/39903090857);
    its build job passed, and its `vsix` artifact holds the three VSIX at
    0.1.10, each manifest carrying `Microsoft.VisualStudio.Code.PreRelease`.
- [x] The publish job needs the build job, runs in the environment `release`
  with `id-token: write`, signs in with `azure/login` (`client-id` and
  `tenant-id` from the environment secrets `AZURE_CLIENT_ID` and
  `AZURE_TENANT_ID`, `allow-no-subscriptions: true`), runs
  `bunx vsce publish --packagePath <host> <workspace> <pack> --skip-duplicate --azure-credential`,
  then `bunx ovsx publish` for each VSIX with `OVSX_PAT`, and creates a GitHub
  Release holding the three VSIX files.
  - **Evidence:** In [run
    39903090857](https://github.com/plume-works/vscode-expo-bridge/actions/runs/39903090857),
    the publish job waited for the `release` environment's approval, then
    published all three to the Visual Studio Marketplace through
    `--azure-credential` and to Open VSX with `OVSX_PAT`, and created the GitHub
    pre-release
    [`v0.1.10`](https://github.com/plume-works/vscode-expo-bridge/releases/tag/v0.1.10)
    holding the three VSIX files.
- [x] `ovsx` is pinned to an exact version in the root `devDependencies`, next
  to `@vscode/vsce`.
  - **Evidence:**
    [`48467e9`](https://github.com/plume-works/vscode-expo-bridge/commit/48467e9):
    the root `package.json` `devDependencies` hold `"ovsx": "1.3.0"` next to
    `"@vscode/vsce": "3.6.2"`.
- [x] `marketplace-identity.yml` runs only on `workflow_dispatch`, in the
  environment `release` with `id-token: write`, signs in the same way, and
  prints the identity's Marketplace profile with
  `az rest -u https://app.vssps.visualstudio.com/_apis/profile/profiles/me --resource 499b84ac-1321-427f-aa17-267ca6975798`.
  - **Evidence:** `marketplace-identity.yml` on `main` (`f0644d7`), dispatched
    from the tag `v0-identity-2` and approved in `release`, succeeded in [run
    39901281087](https://github.com/plume-works/vscode-expo-bridge/actions/runs/39901281087)
    and printed the profile `id` `9b5a92a1-ea20-6f94-a3ed-6ac9942f044f`.
- [x] CI passes on the pull request that adds both workflows, and on `main`
  after it merges.
  - **Evidence:** CI passed on [PR
    #14](https://github.com/plume-works/vscode-expo-bridge/pull/14) and, after
    its squash merge `48467e9`, on `main` in [run
    39900184569](https://github.com/plume-works/vscode-expo-bridge/actions/runs/39900184569).

### Task 21c: Publishing accounts

**Files:** none — done by the user in the Visual Studio Marketplace, Azure,
GitHub, and Open VSX

- [x] The Visual Studio Marketplace publisher `plume-works` exists.
  - **Evidence:** https://marketplace.visualstudio.com/publishers/plume-works
    answers 200, where an unknown publisher answers 404 (checked 2026-10-23).
- [x] A user-assigned managed identity has a federated credential with subject
  `repo:plume-works@309183396/vscode-expo-bridge@1427809780:environment:release`,
  the immutable form GitHub issues for this repository.
  - **Evidence:** In `marketplace-identity.yml` [run
    39900424180](https://github.com/plume-works/vscode-expo-bridge/actions/runs/39900424180),
    dispatched from the tag `v0-identity` and approved in `release`, the
    `azure/login` step signed in as the identity.
- [x] `plume-works/vscode-expo-bridge` has the environment `release`, with the
  user as required reviewer, deployment limited to `v*` tags, and the secrets
  `AZURE_CLIENT_ID` and `AZURE_TENANT_ID` of that identity.
  - **Evidence:**
    `gh api repos/plume-works/vscode-expo-bridge/environments/release` on
    2026-10-23: a `required_reviewers` rule with `anton-matosov`, a custom
    deployment policy whose only rule is the tag pattern `v*`, and the secrets
    `AZURE_CLIENT_ID` and `AZURE_TENANT_ID`.
- [x] The profile ID that `marketplace-identity.yml` prints is a member of the
  `plume-works` publisher with the Contributor role.
  - **Evidence:** On 2026-10-23 the `plume-works` publisher's Members page lists
    the identity (`<tenant>\ff8195d2-f323-4507-99e7-6d55e837b35d`, the
    descriptor run 39901281087 printed) with the Contributor role; the identity
    holds Reader on the resource group `vscode-publishing`.
- [x] An Open VSX account linked to an Eclipse account that signed the Eclipse
  Foundation Open VSX Publisher Agreement owns the namespace `plume-works`, and
  its access token is the `release` environment secret `OVSX_PAT`.
  - **Evidence:** On 2026-10-23, https://open-vsx.org/api/plume-works returns
    the namespace `plume-works` (creating one requires the signed Publisher
    Agreement), and the `release` environment lists the secret `OVSX_PAT`.

### Task 22: Publish pre-releases to the Visual Studio Marketplace

- [x] `plume-works.vscode-expo-bridge`, `plume-works.vscode-expo-bridge-host`,
  and `plume-works.vscode-expo-bridge-workspace` are published to the Visual
  Studio Marketplace as pre-releases with an odd minor version by a Task 21b
  release workflow run, from a tag on the commit Task 21's last box tested.
  - **Evidence:** [run
    39903090857](https://github.com/plume-works/vscode-expo-bridge/actions/runs/39903090857)
    from the tag `v0.1.10` on `f0644d7`, the commit Task 21's last box tested;
    the Marketplace gallery query on 2026-10-23 returns 0.1.10 with
    `Microsoft.VisualStudio.Code.PreRelease` `true` for all three.

### Task 23: Publish pre-releases to Open VSX

- [x] `plume-works.vscode-expo-bridge`, `plume-works.vscode-expo-bridge-host`,
  and `plume-works.vscode-expo-bridge-workspace` are published to Open VSX as
  pre-releases with the same versions as Task 22, by the same workflow run.
  - **Evidence:** The same run; on 2026-10-23
    `https://open-vsx.org/api/plume-works/<name>` returns version 0.1.10 with
    `preRelease: true` for all three.

### Task 24: Pre-release test on a Mac

**Files:** none — the Task 21 scratch app on a Mac, with the Task 21 VSIX
installs removed and the app uninstalled from the simulator:

``` bash
xcrun simctl uninstall booted dev.plumeworks.expobridgespike
```

- [x] Installing the pack's pre-release from the Visual Studio Marketplace in VS
  Code on the Mac puts the host extension's pre-release in the local extension
  host and the workspace extension's pre-release in the container of a Dev
  Containers window on the scratch app.
  - **Evidence:** Run on 2026-10-23 on the Mac after removing the Task 21 VSIX
    installs and the app: installing the pack's pre-release 0.1.10 from the
    Visual Studio Marketplace in the scratch app's Dev Containers window put
    `plume-works.vscode-expo-bridge`, `-host`, and `-workspace` 0.1.10 on both
    the Mac and the container (`code --list-extensions` on each);
    `eas-host build` then ran on the Mac through the host extension, and
    `eas-host` ran in the container through the workspace extension.
- [x] Task 21's `eas-host` action sequence, trust prompt, build confirmation,
  and Metro load over port 8081 behave the same with the pre-releases.
  - **Evidence:** Run on 2026-10-23 on the Mac with the Marketplace pre-release
    0.1.10: after the workspace's trust was revoked, the first `eas-host status`
    raised the trust prompt naming the workspace's Mac path;
    `eas-host build development` raised the build confirmation, a Cancel
    answered `build-declined`, and an Allow once ran `build` (eas-cli 25.3.0),
    `install`, `launch`, and `screenshot` to exit 0, with Metro in the container
    logging `iOS Bundled 381ms index.js (712 modules)`. The fix ran from both
    the notification and the status bar item, and the item cleared on the next
    `status`.

### Task 25: Publish releases to the Visual Studio Marketplace

- [x] `plume-works.vscode-expo-bridge`, `plume-works.vscode-expo-bridge-host`,
  and `plume-works.vscode-expo-bridge-workspace` are installable from the Visual
  Studio Marketplace as releases with the next even minor version by a Task 21b
  release workflow run, built from the code Task 24 tested.
  - **Evidence:** [run
    39907262994](https://github.com/plume-works/vscode-expo-bridge/actions/runs/39907262994)
    from the tag `v0.2.0` on `dd8ce13` (PR #16), which differs from `f0644d7`,
    the code Task 24 tested, only in the three `package.json` versions; the
    Marketplace gallery query on 2026-10-23 returns 0.2.0 with no
    `Microsoft.VisualStudio.Code.PreRelease` property for all three.

### Task 26: Publish releases to Open VSX

- [x] `plume-works.vscode-expo-bridge`, `plume-works.vscode-expo-bridge-host`,
  and `plume-works.vscode-expo-bridge-workspace` are installable from Open VSX
  as releases with the same versions as Task 25, by the same workflow run, with
  `OVSX_PAT`.
  - **Evidence:** The same run; on 2026-10-23
    `https://open-vsx.org/api/plume-works/<name>` returns version 0.2.0 with
    `preRelease: false` for all three.

### Task 26b: Release test in VSCodium on a Mac

**Files:** none — the Task 21 scratch app in VSCodium on a Mac, with the
`s-h-a-d-o-w.dev-containers-oss` extension,
`"enable-proposed-api": ["s-h-a-d-o-w.dev-containers-oss"]` in VSCodium's
runtime arguments, and the app uninstalled from the simulator:

``` bash
xcrun simctl uninstall booted dev.plumeworks.expobridgespike
```

- [x] Installing the pack's Task 26 release from Open VSX in VSCodium on the Mac
  puts the host extension in the local extension host and the workspace
  extension in the container of an `s-h-a-d-o-w.dev-containers-oss` window on
  the scratch app.
  - **Evidence:** Run on 2026-10-23 on the Mac: with the pack 0.2.0 installed
    from Open VSX, `codium --list-extensions --show-versions` lists
    `plume-works.vscode-expo-bridge`, `-host`, and `-workspace` 0.2.0 on both
    the Mac and the container; `eas-host status` in the container returned
    `available: true` with `hostPathExists`, `workspaceTrusted`, and
    `port8081Forwarded` ok.
- [x] Task 21's `eas-host` action sequence, trust prompt, build confirmation,
  Metro load over port 8081, and one-click fix behave as in VS Code.
  - **Evidence:** Run on 2026-10-23 on the Mac in the same window, with the app
    absent from the simulator: the first `eas-host` call raised the trust prompt
    and `build` the build confirmation; Task 21's script then ran `status`,
    `build` (eas-cli 25.3.0), `install`, `launch`, and `screenshot` to exit 0,
    with Metro in the container logging
    `iOS Bundled 365ms index.js (512 modules)`. A container bun newer than the
    Mac's raised the fix notification and status bar item, the fix opened a
    terminal on the Mac, and the item cleared on the next `status`.

### Task 26c: Document the host extension's one-click install in the sibling repository

**Files:** Modify: `README.md`, `packages/pack/README.md` in
`plume-works/vscode-expo-bridge`

- [x] `README.md` and the pack's `packages/pack/README.md` state that a
  devcontainer listing the pack in `customizations.vscode.extensions` installs
  the workspace extension in the container and leaves the host extension
  disabled there, and that one click on the host extension's **Install
  Locally**, once per Mac, installs it in the local extension host, with
  **Reload Window** in windows already open, and that in a Codespace the
  workspace extension activates after one **Reload Window**; the pack README no
  longer says the pack installs the host extension in the Mac's local extension
  host. CI passes on its pull request and on `main`.
  - **Evidence:** [PR
    #17](https://github.com/plume-works/vscode-expo-bridge/pull/17),
    squash-merged as `79d9b29` with the patch bump to 0.2.1: `README.md` and
    `packages/pack/README.md` describe the **Install Locally** click once per
    Mac, **Reload Window** in windows already open, and one **Developer: Reload
    Window** in a Codespace, and the pack README says where each extension runs
    instead of that the pack installs the host extension locally. CI passed on
    the pull request and on `main` ([run
    39920579798](https://github.com/plume-works/vscode-expo-bridge/actions/runs/39920579798)).

### Task 27: Wire the bridge into the Expo profile

**Files:** Modify:
`.agents/plugins/agentdev/skills/template-consume/references/consumption-guide.md`

- [x] `## Optional Expo setup` adds `plume-works.vscode-expo-bridge` to
  `customizations.vscode.extensions`, `8081` to `forwardPorts`, and this entry
  to the existing `portsAttributes` map in the consumer's
  `.devcontainer/devcontainer.json`, and writes no bridge trust or security
  setting:

  ``` json
  "8081": {
    "label": "Metro",
    "onAutoForward": "silent"
  }
  ```

  - **Evidence:** Step 6 of `## Optional Expo setup` in `consumption-guide.md`
    adds the extension, `8081` to `forwardPorts`, and the `"8081"` entry above,
    verbatim in a `json` block, to the existing `portsAttributes` map, and keeps
    the no-trust-setting sentence; Prettier check passes.

- [x] The `## Expo` section of the merged `AGENTS.md` gains a rule: for an iOS
  build, run `eas-host status`; when it succeeds use `eas-host`, otherwise use
  EAS cloud.

  - **Evidence:** Step 4 of `## Optional Expo setup` in commit `2ec13c2`
    appends, verbatim after the command-translation line, the rule to run
    `eas-host status` first and use `eas-host` when it exits 0, otherwise
    `bunx eas-cli@latest build -p ios`.

### Task 28: Record the bridge in the template boundary and architecture

**Files:** Modify: `docs/knowledge/data/architecture/template-boundary.md`;
Create: `docs/knowledge/data/architecture/vscode-expo-bridge.md`; Modify:
`docs/knowledge/data/architecture.md`

- [x] The template boundary's Expo profile section names the extension pack, the
  forwarded port with its silenced auto-forward notification, the `AGENTS.md`
  rule, and that setup grants no trust.
  - **Evidence:** `## Optional Expo profile` in `template-boundary.md` names
    `plume-works.vscode-expo-bridge`, `8081` in `forwardPorts` with its
    `portsAttributes` entry `"onAutoForward": "silent"`, the `eas-host status`
    rule, and that setup writes no trust or security setting;
    `iwe schema validate` passes.
- [x] `data/architecture/vscode-expo-bridge` records the design in `## Approach`
  with its security model and rejected alternatives, and links the sibling
  repository's protocol document; `data/architecture.md` links it.
  - **Evidence:** Commit `d00d985` creates
    `docs/knowledge/data/architecture/vscode-expo-bridge.md`, whose
    `## Approach` holds `### Security model`, `### Constraints`, and
    `### Rejected alternatives` and whose `## Context` links
    `plume-works/vscode-expo-bridge` `docs/protocol.md`, and adds its inclusion
    link to `docs/knowledge/data/architecture.md`; `iwe schema validate` passes.

### Task 28b: State the one-click host install in the Expo profile docs

**Files:** Modify:
`.agents/plugins/agentdev/skills/template-consume/references/consumption-guide.md`,
`docs/knowledge/data/architecture/vscode-expo-bridge.md`,
`docs/knowledge/data/architecture/template-boundary.md`

- [x] The paragraph after step 6 of `## Optional Expo setup` tells the user that
  the first window on a Mac shows the host extension disabled in the container,
  and that one click on its **Install Locally** in the Extensions view, once per
  Mac, enables the bridge, with **Reload Window** in windows already open, and
  that in a Codespace the workspace extension activates after one **Reload
  Window**.
  - **Evidence:** Commit `a248b1a` adds, after the paragraph that follows step 6
    of `## Optional Expo setup` in `consumption-guide.md`, a paragraph on **Expo
    Bridge (Host)** disabled with **Install Locally** in the first window on a
    Mac, one click once per Mac, **Reload Window** in windows already open, and
    one **Developer: Reload Window** in a Codespace; Prettier check and
    `uv run validate_agent_files --recommend . --require-marketplace claude codex`
    (62/62 valid) pass.
- [x] `data/architecture/vscode-expo-bridge` `## Approach` and the template
  boundary's `## Optional Expo profile` state that the listed pack installs the
  workspace extension in the container and that the host extension is installed
  locally by that one click, and the architecture doc's
  `### Rejected alternatives` records listing only the workspace extension.
  - **Evidence:** Commit `a248b1a`: `## Approach` in
    `architecture/vscode-expo-bridge.md` states that the listed pack installs
    the workspace extension in the container and the host extension takes one
    **Install Locally** click once per Mac, and its `### Rejected alternatives`
    lists listing only the workspace extension; `## Optional Expo profile` in
    `template-boundary.md` states the same install split; `iwe schema validate`
    passes.

### Task 29: Validate the catalog change

- [x] `uv run validate_agent_files --recommend . --require-marketplace claude codex`
  passes.
  - **Evidence:** Run on the tree of commit `25d756c` (the Task 27 and 28
    catalog and knowledge changes, including the silenced Metro port): 62/62
    skills valid, 0 errors, 0 warnings.

### Task 30: End to end on a Mac from the released pack

- [x] In an Expo consumer adopted with the Expo profile and opened by VS Code on
  a Mac with no bridge extension installed beforehand, the released pack listed
  in `devcontainer.json` installs the workspace extension in the container and
  shows the host extension disabled with **Install Locally**; one click on it
  puts the host extension in the local extension host.
  - **Evidence:** Run on 2026-10-23 on the Mac with the t21 app adopted from
    this repository at `c9bea80` (Workflow B, `"expo"`), after
    `code --uninstall-extension` left the Mac with no `plume-works` extension:
    the container's `code --list-extensions` listed the pack, `-host`, and
    `-workspace` 0.2.0, and the Extensions view showed the host extension
    "disabled in this workspace because it is defined to run in the Local
    Extension Host" with **Install Locally**. After that one click,
    `eas-host status` in the container returned `available: true` with `macHost`
    and `hostPathExists` ok, answered by the host extension on the Mac.
- [x] In that window `eas-host status` succeeds, and `eas-host build` with a
  simulator profile from `eas.json` leaves the artifact under
  `.tmp/expo-bridge/`.
  - **Evidence:** Run on 2026-10-23 on the Mac in the same window: Task 21's
    script ran `eas-host status` (`available: true`, exit 0) and
    `eas-host build development` (eas-cli 25.3.0, exit 0), which left the
    `.tar.gz` artifact under `.tmp/expo-bridge/`; `install`, `launch`, and
    `screenshot` exited 0, and the launched development build loaded its bundle
    from Metro in the container.
- [x] After a container rebuild of that window, the host extension runs in the
  local extension host with no further click, and `eas-host status` succeeds.
  - **Evidence:** Run on 2026-10-23 on the Mac in the same consumer,
    `plume-works/expo-bridge-t21` `template-adoption` (`.agent.metadata.json`:
    `consumed_ref` `c9bea80`, `optional_bundles: ["expo"]`), with the pack 0.2.0
    that release run 39907262994 published: after **Dev Containers: Rebuild
    Container**, with no click, `eas-host status` returned `available: true`
    with `macHost`, `hostPathExists`, and `workspaceTrusted` ok.

### Task 31: Fallback when the bridge is unavailable

- [x] In a Codespace of the same consumer opened by VS Code on a Mac,
  `eas-host status` reports unavailable and exits non-zero, and
  `bunx eas-cli@latest build -p ios --non-interactive --no-wait` still submits
  to EAS cloud.
  - **Evidence:** Run on 2026-10-23 in a Codespace of the t21 consumer
    (`anton-matosov/expo-bridge-t21` `template-adoption`, codebase-memory-mcp
    turned off in its lifecycle) opened by VS Code on the Mac, after **Reload
    Window** activated the workspace extension: `eas-host status` returned
    `available: false` with `hostPathExists` "workspace host path does not exist
    locally" and exited 3. After `bun install`,
    `bunx eas-cli@latest build -p ios --profile development --non-interactive --no-wait`
    (the app's `eas.json` has no default `production` profile) uploaded the
    project and queued EAS build `d3e559c6-9402-4d8d-96ed-23346999ddb7`.

## Spec changes

Modifies [Template consumption](../spec/template-consumption.md):

``` markdown
## ADDED Requirements

### Requirement: an Expo consumer can build iOS on a Mac host through the bridge

When the consumer's `optional_bundles` includes `"expo"`, setup SHALL list
`plume-works.vscode-expo-bridge` in `customizations.vscode.extensions`, add
`8081` to `forwardPorts` with the `portsAttributes` entry
`"8081": { "label": "Metro", "onAutoForward": "silent" }`, and add to the
`## Expo` section of the root
`AGENTS.md` a rule that an iOS build uses `eas-host` when `eas-host status`
succeeds and EAS cloud otherwise. Setup SHALL NOT add any host command bridge
other than this extension pack, SHALL NOT change the firewall allowlist for it,
and SHALL NOT pre-authorize the bridge: trust in a workspace is granted only on
the Mac.

#### Scenario: an Expo consumer is opened by VS Code on a Mac

- **WHEN** an Expo consumer's devcontainer is opened by VS Code on a Mac with
  the listed pack's workspace extension in the container, the host extension
  installed locally on the Mac, the tools `eas-host status` checks present, and
  the workspace trusted on the Mac
- **THEN** `eas-host status` succeeds
- **AND** `eas-host build` with a profile from `eas.json` leaves the artifact
  under `.tmp/expo-bridge/`

#### Scenario: setup grants no trust

- **WHEN** setup applies the Expo profile
- **THEN** it writes no bridge trust or security setting into any consumer file
- **AND** the first bridge request from the consumer's workspace asks for trust
  on the Mac

#### Scenario: the bridge is unavailable

- **WHEN** the devcontainer runs where the workspace is not on the VS Code host
  — a Codespace, a non-Mac host, or no VS Code window
- **THEN** `eas-host status` exits non-zero
- **AND** the EAS cloud build path works unchanged

#### Scenario: a non-Expo consumer

- **WHEN** the consumer's `optional_bundles` omits `"expo"`
- **THEN** setup adds neither the extension pack, the forwarded port, its
  `portsAttributes` entry, nor the rule
```

The protocol contract and security model are specified in
`plume-works/vscode-expo-bridge` (`docs/protocol.md`), not in this repository.

## Depends on

- [Expo profile for template adoption](20261014-expo-eas-template-profile.md) —
  Task 27 extends its `## Optional Expo setup` section and its `## Expo`
  `AGENTS.md` section.

## Verification

- Every Task 1–10 spike check is ticked.
- The sibling repository's CI passes on `main`.
- Task 21's local run passes on the commit the first pre-release tag points at
  before any version is published, and Task 24's pre-release run passes before
  any release is published.
- Every publish is a release workflow run from a `vX.Y.Z` tag whose publish job
  waited for the `release` environment's reviewer, and the repository holds no
  Marketplace token.
- The pack and both extensions install from both the Visual Studio Marketplace
  and Open VSX.
- `uv run validate_agent_files --recommend . --require-marketplace claude codex`
  passes.
- Task 26b's VSCodium run, Task 30's end-to-end run, and Task 31's fallback run
  behave as described.
- No document in this repository or the sibling repository says that listing the
  pack in `devcontainer.json` installs the host extension on the Mac.
- `iwe normalize` and `iwe schema validate` pass.

## Verification results

### Task 5: a `sandbox-exec` build fails on nested sandboxing

Under the Task 5 profile, the Expo SDK 58 simulator build fails in the
`ExpoModulesJSI` pod's `[CP-User] Build ExpoModulesJSI xcframework` script
phase. That phase runs `xcodebuild`, which resolves Swift packages, and SwiftPM
sandboxes manifest evaluation with `sandbox-exec`. Inside the outer sandbox it
fails with
`Could not resolve package dependencies: sandbox-exec: sandbox_apply: Operation not permitted`.
macOS does not apply a sandbox inside another, so no change to the profile's
rules fixes it. The probe check passed under the same profile.

Two constraints on any sandboxed build follow:

- eas-cli's default git packing runs `git config core.ignorecase false` in the
  project's repository, a write to the workspace's `.git/config`. With
  `EAS_NO_VCS=1` it writes nothing in `.git`. Its archive still honors
  `.gitignore` (no `node_modules`) and includes untracked files.
- The build's inner tools may sandbox themselves. A containment mechanism must
  allow that, or turn it off for the build's process tree only.

### Task 5: the inner-sandbox override cannot be scoped to the build

The failing nested build is started by `expo-modules-jsi`'s
`build-xcframework.sh` as `env -i PATH HOME PODS_ROOT RN_ROOT … xcodebuild`.
That rules out any override passed in the environment, such as
`CFFIXED_USER_HOME`. An `xcodebuild` shim that adds
`-IDEPackageSupportDisableManifestSandbox=YES` is accepted when called directly,
but it never reaches the nested call. Xcode puts its own tool directories,
including `Contents/Developer/usr/bin`, ahead of the script phase's `PATH`, even
when an `XCODE_XCCONFIG_FILE` sets `PATH = <shim>:$(inherited)`. The user's
`com.apple.dt.Xcode` defaults stayed unchanged throughout, and the `postinstall`
probes stayed blocked.

Turning off the inner sandboxes for one build would mean depending on Expo's
script internals, Xcode's `PATH` assembly, and an undocumented Xcode default.

### Task 7: the window already grants the container host reach

A workspace (container) extension that is not the bridge reaches the Mac through
VS Code's own commands. On a macOS Dev Containers window it ran
`workbench.action.terminal.newLocal` then
`workbench.action.terminal.sendSequence` with no consent prompt, and a marker
command executed on the Mac — a file with the attacker's nonce appeared under
the Mac's `/tmp` and was absent in the container's. The same extension read and
wrote the Mac clipboard. `VSCODE_IPC_HOOK_CLI` is present in the container and
the remote `code` CLI answers, so a detached container process reaches it. The
SSH agent (`SSH_AUTH_SOCK`) and the GPG agent are forwarded into the container;
`ssh-add -l` from the container listed the user's private keys. `openExternal`
to a URL was gated by a Mac consent prompt rather than opening silently.

The bridge installs nothing that changes this. The plan's security model is
therefore the narrower one in `## Approach`: the bridge adds no reach beyond
what the window grants, and gates its own `build` behind trust and confirmation.
The forwarded SSH and GPG agents are a devcontainer-wide exposure independent of
this feature, recorded as the someday idea [Narrow the devcontainer's forwarded
agent exposure](../someday/devcontainer-forwarded-agent-exposure.md) for
research into whether it can be narrowed without breaking the workflows that
rely on it.

### Task 6: a command invocation carries no caller identity

The non-bridge attacker extension invoked the `ui` side's command and received
the full host path back; the handler saw only its own arguments, nothing naming
the caller or its host. After the attacker injected a workspace folder with
`updateWorkspaceFolders`, the `ui` side still resolved the window's original
`dev-container+…` authority and host path, so folder injection does not redirect
the bridge. A workspace extension holds no handle to another extension's
`SecretStorage` or `globalState`.

### Tasks 12–20 code precedes the Mac-only spikes

The extension code (Tasks 12–20) was written on a Linux devcontainer with no
macOS host in reach, under user direction, ahead of the plan-ordered macOS
spikes it depends on. The Task 9 and 10 findings confirm the `realpath` symlink
rule, the `O_CREAT | O_EXCL | O_NOFOLLOW_ANY` write rule, archive-entry
rejection, and `status`'s direct tool probes as written.

### Task 9: the workspace file boundary holds on macOS

Run on 2026-10-21 against the Mac host `robomac.local` through the spike bridge
(`ui` extension commands driven from the container). All four checks pass:

- `O_NOFOLLOW_ANY` (`0x20000000`) in Node's `fs.open` refuses a path with a
  symlink in any component — a symlinked directory component and a final-
  component symlink both failed with `ELOOP`.
  `O_CREAT | O_EXCL | O_NOFOLLOW_ANY` created a fresh file, and a second create
  failed with `EEXIST`. This is the behavior the host extension's write rule
  relies on.
- eas-cli's artifact write does not need a writable workspace path: the host
  extension builds into private global storage and copies out under the fresh-
  write rule, so a symlink planted at the artifact's name or in place of the
  artifacts dir is never followed.
- Unpacking crafted archives with `tar -xk` into a fresh directory, as `install`
  does: a `../escape` entry is rejected (`Path contains '..'`), an absolute
  entry has its leading `/` stripped by bsdtar, and a symlink entry lands in the
  tree but the write through it does not reach outside — and the post-extract
  symlink scan catches it, so `install` rejects the artifact.
- Reading `eas.json` presented as a symlink, a FIFO, and a 2 MiB file: each is
  refused (symlink, not-regular, too-large) without blocking and without
  returning any file bytes. The `O_NONBLOCK` open is what keeps the FIFO read
  from hanging.

### Task 10: cocoapods, fastlane, and image are not eas.json build fields

eas-cli 25.3.0 rejects `cocoapods`, `fastlane`, and `image` as `build.<profile>`
keys at schema validation (`"build.t10.cocoapods" is not allowed`, and likewise
for the other two). They are not `eas build --local` profile fields, so the
design cannot route those tool versions through `eas.json`; `status` must probe
CocoaPods and fastlane on the Mac directly, as it does. `node` is an accepted
field, but a local build does not honor it: with `"node": "20.18.0"` pinned,
eas-cli warns that the `eas.json` Node.js version does not match the one
installed and builds with the Mac's own Node. `status` therefore checks the
Mac's own Node rather than trusting the profile.

Each `eas build --local` runs in a fresh working directory under the system
temporary directory and reinstalls everything: two builds of the unchanged app
each installed all 443 packages and all 103 pods. The only reuse is from the
Mac's shared caches (bun's package cache, CocoaPods' cache), which makes the
repeat install faster but not skipped.

### Task 8: a container-written `.app` installs and launches

An `.app` placed under the workspace's `.tmp/` by the container, not produced by
a build, installs on a booted simulator through `xcrun simctl install` and
launches through `xcrun simctl launch`, with its bundle id read from its
`Info.plist`. Nothing in the simulator path verifies that an `.app` came from a
bridge build. `install`, `launch`, and `screenshot` also need a booted
simulator; with none booted, `simctl` fails with `No devices are booted`, so the
bridge must create and boot one (`simctl create`, `boot`, `bootstatus -b`)
before acting.

### Task 8: code in the Simulator runs unconfined as the Mac user

A process the booted iOS 26.5 simulator runs
(`xcrun simctl spawn booted /bin/sh`) can list the user's `~/.ssh`, read
`~/.ssh/known_hosts`, and create a file in `~/Library/LaunchAgents`, with the
simulator's own data directory as the positive control. The Simulator is no
containment boundary: whatever native code the container gets installed and
launched runs with the Mac user's full file access, including persistence
through LaunchAgents. The probe ran as a simulator-runtime process, not inside
the installed app.

### Task 26b: one VSCodium dev container extension carries the host path

VSCodium cannot use Microsoft's Dev Containers extension, and the host extension
works only in a window whose authority is `dev-container+<hex>` with the Mac
path in its payload. Of the Open VSX dev container extensions,
`s-h-a-d-o-w.dev-containers-oss` produces that authority and runs the whole Task
21 sequence. It ignores the `portsAttributes` `"onAutoForward": "silent"` entry,
so VSCodium still shows the port 8081 forwarding notification. The others do not
work:

- `DDorch.codium-devcontainer` runs `postCreateCommand` as a `RUN` step of its
  generated Dockerfile, before the workspace is mounted, so the image build
  fails.
- `mythreyak.open-remote-devcontainer` does not connect to the container.
- `3timeslazy.vscodium-devpodcontainers` and `zwhy2025.open-dev-container`
  connect over SSH, whose authority carries no Mac path.

### Task 30: `devcontainer.json` installs the host extension in the container

On a Mac with no bridge extension installed, opening the adopted consumer with
the pack listed in `customizations.vscode.extensions` installed the pack, the
host extension, and the workspace extension 0.2.0 in the container and none on
the Mac. VS Code disabled the host extension there with "This extension is
disabled in this workspace because it is defined to run in the Local Extension
Host. Please install the extension locally to enable." and offered **Install
Locally**. VS Code's Dev Containers documentation describes the list as the
extensions "installed when the container is created". Installing the pack from
the Extensions view in an open window (Tasks 24 and 26b) does put the host
extension on the Mac.

In a Codespace, VS Code installs the listed extensions after the window opens,
and the workspace extension activates, installing `eas-host`, only after
**Reload Window**; before that `eas-host` is not on `PATH`.

One **Install Locally** click installs the host extension for the whole Mac:
every other open Dev Containers window then offers **Reload Window**, after
which the host extension runs there too.

## Out of scope

- Android builds through the bridge; the container builds Android itself.
- Device and store builds that need Apple signing; the bridge covers simulator
  builds, and `eas credentials` stays a one-time human step.
- A generic host-command facility.
- Hosts other than VS Code desktop and VSCodium on macOS, and editors that
  cannot run a `ui` extension locally.
- Documenting the VSCodium setup in the sibling repository, tracked as the
  backlog task [Document VSCodium support for the Expo
  bridge](../backlog/document-expo-bridge-vscodium-support.md).
- Changes to this repository's own `.devcontainer/`.
- Publishing on a merge to `main` without a tag, and publishing from a developer
  machine.
- Open VSX trusted publishing; Open VSX publishing stays on `OVSX_PAT`.
- Installing the host extension on the Mac without a user click, and publishing
  a version only to refresh the Marketplace README.
- Installing Xcode itself unattended.
- Linking the EAS project (`eas init`) through the bridge.
- Containing a build on the Mac: a trusted, confirmed build runs with the Mac
  user's privileges.
- Removing the host reach a devcontainer window already grants (local terminal,
  forwarded agents); the bridge adds none of it and cannot take it away.
  Narrowing the forwarded SSH and GPG agent exposure is tracked separately as a
  someday idea.
- Further probing of the window's host reach or the Simulator's containment:
  both are open (`## Verification results`, Tasks 7 and 8), and the
  consent-surface model assumes both. Excluded by user decision on 2026-10-21.

## Key references

Verified anchor points (line numbers as of 2026-10-23):

- `.devcontainer/devcontainer.json:53` — `forwardPorts`
- `.devcontainer/devcontainer.json:54` — `portsAttributes`, the map the Expo
  profile's `8081` entry joins
- `.devcontainer/devcontainer.json:115` — `customizations.vscode.extensions`
- `.devcontainer/docker-compose.yml:84` — the workspace bind mount at
  `/workspaces/<basename>`
- `.gitignore:11` — `.tmp/` ignored
- `ansible/roles/bash_setup/tasks/main.yml:3` — `~/.local/bin` on `PATH`
- `.agents/plugins/agentdev/skills/template-consume/SKILL.md:50` —
  `optional_bundles` row of the marker table
- `.agents/plugins/agentdev/skills/template-consume/references/consumption-guide.md:928`
  — `## Optional Expo setup`
- `.agents/plugins/agentdev/skills/template-consume/references/consumption-guide.md:991`
  — step 6, the `devcontainer.json` edits; `:1006` — the paragraph on what the
  pack does once the devcontainer opens; `:1015` — the **Install Locally** and
  **Reload Window** paragraph
- `docs/knowledge/data/architecture/vscode-expo-bridge.md:32` — the pack and
  where each extension runs; `:127` — `### Rejected alternatives`
- `docs/knowledge/data/architecture/template-boundary.md:256` —
  `## Optional Expo profile`
- `docs/knowledge/data/architecture/template-boundary.md:269` — the
  `forwardPorts` sentence
- `docs/knowledge/data/spec/template-consumption.md:82` — Requirement: adoption
  is recorded for later updates
- `plume-works/vscode-expo-bridge` `.github/workflows/ci.yml:20` — the bun pin
  the release workflow matches; `:29` — `bun run package`
- `plume-works/vscode-expo-bridge` `.github/workflows/release.yml:5` — the
  strict `vX.Y.Z` tag trigger; `:48` — the publish job's `environment: release`;
  `:76` and `:81` — the Marketplace and Open VSX publish steps
- `plume-works/vscode-expo-bridge` `packages/release/src/release.ts` —
  `checkTag`, `channelOf`
- `plume-works/vscode-expo-bridge` `package.json:19` — the `bump` script; `:24`
  — the `@vscode/vsce` pin; `:25` — `ovsx`
- `plume-works/vscode-expo-bridge` `packages/release/src/bump.ts:5` —
  `EXTENSIONS`, the three packages that share one version
- `plume-works/vscode-expo-bridge` `packages/host/package.json:51`,
  `packages/workspace/package.json:27`, `packages/pack/package.json:24` — the
  `vsce package` scripts
- `plume-works/vscode-expo-bridge` `README.md:7` — installing the pack; `:16` —
  the devcontainer-listed pack and **Install Locally**;
  `packages/pack/README.md:4` — where each extension runs; `:7` — the
  devcontainer-listed pack and **Install Locally**
- `plume-works/vscode-expo-bridge` `packages/host/src/hostpath.ts:11` —
  `decodeHostPath`, which reads the Mac path from a `dev-container+<hex>`
  authority
