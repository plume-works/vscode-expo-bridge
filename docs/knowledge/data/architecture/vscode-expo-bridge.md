---
type: architecture
description: How an Expo consumer's devcontainer builds, installs, launches, and screenshots its iOS app on the Mac that opened it — two VS Code extensions bridged by command routing, one socket per window, the request's workspace folder mapped to its Mac path through Docker, a fixed Expo-only action set, and a consent surface rather than a security boundary.
generated:
  by: claude-code/opus-5.5
  at: 2026-10-28T03:00:00Z
sources:
- resource: docs/knowledge/data/plans/20261026-expo-bridge-panel.md
- resource: docs/knowledge/data/plans/20261015-vscode-expo-bridge.md
- resource: docs/knowledge/data/plans/20261023-expo-bridge-workspace-folders.md
- resource: docs/knowledge/data/plans/20261024-expo-bridge-fix-terminal-mac-shell.md
- resource: docs/knowledge/data/plans/20261025-expo-bridge-bun-fix-resolved-bun.md
- resource: docs/knowledge/data/plans/20261023-expo-bridge-fingerprint-reuse.md
- resource: https://code.visualstudio.com/docs/devcontainers/containers
- resource: https://github.com/plume-works/vscode-expo-bridge
- resource: https://github.com/plume-works/vscode-expo-bridge/blob/main/docs/protocol.md
- resource: https://docs.expo.dev/build-reference/local-builds/
- resource: https://code.visualstudio.com/api/advanced-topics/remote-extensions
---

# VS Code Expo bridge

## Context

An Expo consumer builds iOS on EAS cloud Macs from its Linux devcontainer
([Template boundary](template-boundary.md), Optional Expo profile). When VS Code
on a Mac opens that devcontainer, the Mac has Xcode and the iOS Simulator: a
build there costs no EAS quota and lets agents see the running app. The bridge
code lives in the sibling repository
[plume-works/vscode-expo-bridge](https://github.com/plume-works/vscode-expo-bridge),
which owns the protocol contract and security model in
[`docs/protocol.md`](https://github.com/plume-works/vscode-expo-bridge/blob/main/docs/protocol.md).
This repository owns only the template wiring, the EAS cloud fallback, and that
setup grants no trust.

## Approach

The extension pack `plume-works.vscode-expo-bridge` bundles two extensions:

- `plume-works.vscode-expo-bridge-host` (`extensionKind: ["ui"]`) runs in the
  Mac's local extension host with full Node.
- `plume-works.vscode-expo-bridge-workspace` (`extensionKind: ["workspace"]`)
  runs in the container. It installs `eas-host` into `~/.local/bin` and serves
  one socket per window under `/tmp/vscode-expo-bridge/`.

The Expo profile lists the pack in `customizations.vscode.extensions`, which Dev
Containers installs into the container: that brings the workspace extension, and
leaves the host extension disabled there until the user clicks its **Install
Locally**, once per Mac. In a Codespace the workspace extension activates after
one **Developer: Reload Window**.

```
 devcontainer                                 Mac host
┌──────────────────────────────┐   VS Code   ┌───────────────────────────────────┐
│ eas-host <action> ...        │   command   │ host extension (ui)               │
│   │ its window's socket      │   routing   │  ├ trust + build confirmation     │
│   ▼                          │ ──────────▶ │  ├ maps the request's folder to   │
│ workspace extension ─────────┤  + folder   │  │   its Mac path through Docker   │
│                              │             │  ├ eas build --local              │
│ reads the artifact ◀─────────┼─workspace───┼──┤ xcrun simctl install/launch/   │
│                              │   folder    │  │   screenshot                   │
└──────────────────────────────┘             │  └ writes .tmp/expo-bridge/        │
                                             └───────────────────────────────────┘
```

VS Code routes a command to whichever extension host registered it, so a request
crosses from container to Mac as a JSON command argument and opens no network
port; the firewall allowlist does not change. The workspace folder is one
directory seen by both sides, so the artifact and screenshots reach the
container as files under its `.tmp/expo-bridge/`. The build log does not: the
container sees a file on the Mac grow only when the host closes it, so the host
sends each log chunk to the workspace command `expoBridge.workspace.buildLog`
before the `build` response.

### The window and the workspace folder

Several windows can share one container, and a window can hold several workspace
folders, so every request answers which window and which folder it belongs to:

- **One socket per window, found through a registry.** Each workspace extension
  activation serves `/tmp/vscode-expo-bridge/<id>.sock` next to `<id>.json`,
  which names its process, its activation time, and the container paths of its
  workspace folders, rewritten when the folders change. A window removes only
  its own two files, and prunes entries whose process is gone. `eas-host`
  connects to the window with the longest workspace folder containing its real
  working directory, the most recently activated on a tie, and exits 3 when no
  window has one.
- **The project is a workspace folder.** The workspace extension resolves the
  working directory to its longest containing folder and sends that folder's
  container path as `folder`; every request carries one (protocol version 2).
- **The host maps the folder through Docker.** It finds the window's container
  with `docker ps` filtered on the `devcontainer.local_folder` label — the host
  path — and on `devcontainer.config_file` when the window's authority names
  one, against the authority's Docker daemon, and requires exactly one running
  container. It reads that container's bind mounts with `docker inspect`, takes
  the one whose destination is the longest path-component prefix of `folder`,
  and appends the rest to its source. Any failure makes the request unavailable;
  the host never falls back to the window root.

The host accepts exactly five actions — `status`, `build`, `install`, `launch`,
`screenshot` — and never runs a command string from the container. `build` runs
`eas build --local -p ios --profile <name>` for a profile that must exist in
`eas.json`; `install` takes an artifact under `.tmp/expo-bridge/`; `launch`
starts the app `install` last installed; `screenshot` captures the booted
simulator. When the bridge is unavailable, `eas-host status` exits non-zero and
the agent builds on EAS cloud. Metro runs in the container and reaches the
simulator's development build over forwarded port 8081, so the native build
reruns only when native code changes.

The host runs its processes with the Mac user's login environment, captured with
`$SHELL -l -c 'env -0'` (which fish and POSIX shells both accept), plus the
Homebrew prefixes for tool lookup, and starts each with an argument array, never
through a shell. It writes nothing Mac-specific into the shared workspace: no
`eas init`, `expo prebuild`, or package install; linking the EAS project is a
one-time step from the container.

### Build reuse

A development build's `.app` depends only on native inputs, so `build` reuses
the request folder's earlier artifact when a cache key matches:

- **The fingerprint step runs inside the confirmed build.** After trust, the
  confirmation, and the profile and eas-cli checks, the host runs a fixed script
  with the Mac's `node` that loads the project's own `expo/fingerprint` and
  prints `createFingerprintAsync(<folder>, { platforms: ["ios"] })`'s hash.
  eas-cli evaluates the same app config at the same point of every build, so
  this runs no code the confirmed build would not.
- **The key** is a SHA-256 over that hash and the inputs the fingerprint leaves
  out: the profile, the bytes of `eas.json`, `package.json`, and each lockfile,
  `bunx eas-cli@<spec> --version`, `xcodebuild -version`, and the host
  extension's version. Files are read under the bridge's file rules, at most 64
  MiB; any refusal or failed probe means no key and a full build.
- **The cache is per workspace folder**, under
  `build-cache/<sha256 host path>/<sha256 folder Mac path>/` in the host's
  private global storage: an `index.json` and the five newest artifacts, written
  through a temporary file and a rename. The directory comes from the trusted
  host path and the mapped folder only, so two apps under one host path never
  share entries. Revoking a host path's trust deletes every folder's cache under
  it.
- **Index updates are serialized across processes.** Each VS Code window's host
  extension is its own process, and builds in one folder can run from several
  windows at once, so an in-memory lock would not cover them. `store` holds an
  `index.lock` file, created with `O_CREAT | O_EXCL` and naming its process,
  while it copies the artifact and updates `index.json`; the build never holds
  it. A lock whose owner is gone or that is older than 60 s is taken over, and a
  build that waits 10 s for it stores nothing.
- **Only artifacts without an embedded bundle are stored.** An artifact holding
  `main.jsbundle` would carry stale JavaScript, so a Release build always builds
  in full.
- **An artifact `tar -tzf` cannot list is not stored**, since nothing shows it
  holds no `main.jsbundle`. A simulator build's artifact is always a gzipped
  tar, so this refuses no development build.
- **The fingerprint step and the version probes have no timeout**, like the
  eas-cli build they precede, which evaluates the same app config and runs
  through the same `bunx`. A timeout on the probes alone would not bound a
  build, so it is not worth adding.

The fingerprint is a correctness hint, not a security input: project code can
force a match, and the worst outcome is a stale artifact this folder's own
confirmed build produced. Inputs outside the key — EAS server-side environment
variables, the Mac login environment, the macOS and simulator runtimes — need
`--clean`. The protocol stays at version 2: `clean`, `mode`, `reason`, and
`reusedBuiltAt` are optional, so mixed extension versions keep working, and
`eas-host status` compares versions for equality.

### The workspace UI

The panel, the status bar item, and Problems belong to the workspace extension;
the host extension keeps its fix flow, its fix status bar item, and its toasts.

- **One request path.** The socket handler and the panel relay every request
  through one function, which replaces `checks.easProjectId` in each `status`
  result with the container's resolution of the folder's app config, so
  `eas-host status` and the panel always agree. Evaluating `app.config.*` in the
  container runs the container's own code and crosses no trust boundary; only
  the folder's local `node_modules/.bin/expo` is run, never `bunx`, which could
  fetch Expo from the registry.
- **Host commands are called with no arguments.** The UI reaches the Mac only
  through `status` and `build` requests and the existing `expoBridge.fix`,
  `expoBridge.setToken`, and `expoBridge.manageTrust`, each without arguments,
  so the Mac's own picker and prompts decide what runs.
- **Activation awaits no view.** Awaiting a reveal or focus of a view during
  `activate()` deadlocks the extension, so the first `status` runs when the
  panel first becomes visible, never from activation itself.
- **Diagnostics are computed in the container.** It reads its own `eas.json` and
  app config directly and publishes on those files; checks that have no file of
  their own are anchored to the folder's `eas.json`.

### Security model

A devcontainer window already grants the container reach onto the Mac: through
VS Code's own commands a container-side extension opens a local terminal and
runs commands on the Mac, and the SSH and GPG agents are forwarded into the
container. The bridge cannot remove that reach and adds none beyond it. It is
therefore a **consent surface for a cooperative container, not a security
boundary**, and its one privileged action, `build`, runs only behind:

- **per-workspace trust**, granted in a Mac-side prompt naming the workspace's
  host path and stored in the host extension's `globalState`; a decline sticks
  until revoked, so a workspace cannot re-prompt;
- **a confirmation before every `build`**, naming the profile, the folder's Mac
  path, and that project code runs with the user's privileges, with an optional
  per-workspace cooldown.

Trust and the cooldown are keyed to the window's host path, which the host reads
from its own window's remote authority: that is the one location the container
cannot redirect. A request may choose only one of its window's workspace
folders, and the host acts on it only when its Mac path is the host path or lies
under it, with no symlink component below the host path. A container that
reaches the Mac's Docker daemon can label another container with the same host
path, which makes requests unavailable, or mount other Mac directories into it,
which that rule rejects; it can pick no folder outside the host path.

Every command invocation is treated as possibly the container's: VS Code tells a
handler nothing about its caller, so pairing the two extensions is not a
boundary. No security setting is read from any file the container can write.
Outside `build`, the host never evaluates project code; it reads only `eas.json`
and `app.json` as size-limited regular JSON files. The fingerprint step that
decides reuse is part of `build` and never runs before its confirmation. Every
path is workspace-relative and rejected when any component is a symlink, and
every file written into the workspace is created fresh with
`O_CREAT | O_EXCL | O_NOFOLLOW_ANY`; tools write into the host's private storage
and the host copies their output in. `build` sets `EAS_NO_VCS=1` so eas-cli
writes nothing in the workspace's `.git`. `EXPO_TOKEN` lives in VS Code
SecretStorage on the Mac and is placed only in the build's environment.

The build itself is not contained: a trusted, confirmed build runs project code
— lifecycle scripts, config plugins, the `Podfile`, Xcode build phases — as the
Mac user, unsandboxed. The iOS Simulator is no containment boundary either:
simulator processes run with the Mac user's file access.

### Constraints

- `eas build --local` builds in a fresh directory under the Mac's temporary
  directory with its own dependency install, so it never touches the workspace's
  Linux `node_modules`. It uses the Mac's bun and Node whatever `eas.json` pins,
  so `status` checks that the Mac's bun is at least the container's — an older
  bun cannot read the container's `bun.lock`.
- `eas-cli-local-build-plugin` 25.3.0 refuses a non-empty
  `EAS_LOCAL_BUILD_WORKINGDIR`, so no state carries over between local builds;
  reuse works only at the level of the whole artifact.
- A local build does not resolve EAS "Secret" environment variables; values the
  build needs must come from the host environment.
- `cocoapods`, `fastlane`, and `image` are not `eas.json` build fields, so
  `status` probes those tools on the Mac directly.
- Dev Containers labels every container it creates with
  `devcontainer.local_folder` (the host path) and `devcontainer.config_file`,
  and a project may bind the host path more than once, at `/workspaces/<name>`
  and at its own Mac path. Compose files, `runArgs`, and `mounts` add mounts
  that `devcontainer.json` alone does not describe, so only `docker inspect`
  gives the mapping.
- Docker Desktop for Mac reports a bind mount's source as its path inside the
  VM, `/host_mnt/<Mac path>` (sockets under `/socket_mnt/`); the host removes
  `/host_mnt` before mapping.
- The host runs `docker` as the Mac user, from the user-level
  `dev.containers.dockerPath` value when set, else the login `PATH`, the
  Homebrew prefixes, and `~/.docker/bin`. A workspace-level value is never read,
  because the container can write workspace settings.
- A terminal created with a `file:` cwd and no shell path launches on the Mac
  but resolves the default profile's name against the profiles detected in the
  container, so the host gives the one-click fix terminal an explicit
  `shellPath`. It resolves the merged `terminal.integrated.defaultProfile.osx`
  and `profiles.osx` values on the Mac — the named profile, without `source`,
  whose first `path` candidate exists there, with its `args` and `env` — and
  otherwise uses the login shell with `-l`. It reads the merged values, as VS
  Code does for every local terminal, so a trusted workspace can choose the Mac
  shell; the fix commands are shell-neutral.
- The bun fix acts on the bun the check resolved, the first `bun` on the login
  `PATH`, which is also the one `build` runs: `brew upgrade bun` when its real
  path is under `/opt/homebrew/Cellar/`, that binary's absolute path with
  `upgrade` when it is the bun.sh install (`$BUN_INSTALL/bin/bun`, by default
  `~/.bun/bin/bun`), `brew install oven-sh/bun/bun` when none is found, and no
  command otherwise. The fix terminal's own `PATH` can name a different bun, so
  the command carries the absolute path in single quotes; a path containing `'`
  or `\` gets no command. `bun upgrade` replaces its own executable in place,
  and a bare `bun` formula name resolves to the installed formula. The resolved
  path stays on the host, and a bun shadowing a newer one is noted once per pair
  of paths in the host's `globalState`.

### Rejected alternatives

- **A generic host-command bridge** such as `dc2host` — any container process
  could run anything on the Mac.
- **Wrapping `eas`** so `eas build -p ios` routes to the Mac — Expo's plugin
  skills invoke `eas` directly, and silently changing a third-party command's
  meaning is fragile.
- **`expo run:ios` on the Mac** — it builds in the shared workspace against the
  container's Linux `node_modules`.
- **Reading eas-cli's own fingerprint** — a local build does not upload it, and
  intercepting the local build plugin's input means handling an internal handoff
  that carries credentials. `eas fingerprint:generate` writes a Fingerprint
  record to the EAS project on every build.
- **Re-bundling JavaScript into a stored Release artifact** — it re-implements
  Xcode's bundle phase and re-signing.
- **A self-hosted GitHub Actions runner on the Mac** — it needs CI plumbing and
  is not reachable from an open editor window.
- **Listing only the workspace extension** in `devcontainer.json` and telling
  users to install the pack on the Mac — a window opened without that step shows
  nothing to click.
- **A host network port** — command routing needs none and leaves the firewall
  allowlist unchanged.
- **An environment variable naming the socket**, set in each window's terminals
  through `EnvironmentVariableCollection` — it goes stale after a window reload
  and never reaches an agent started outside a VS Code terminal; the registry
  answers both.
- **Reading `workspaceFolder` from `devcontainer.json`** for the mapping — a
  repository may have several configurations, the value uses variables, and
  compose files, `runArgs`, and `mounts` change the mounts it describes.
- **`remote-containers.openDevContainerFile`** for the configuration — in Dev
  Containers 0.469.0 it opens the file in an editor and returns no value.
- **Walking up from the working directory to the nearest `eas.json`** — the
  workspace folder is already the unit VS Code and the agent work in.
- **An optional `folder` on protocol version 1** — an older host would ignore it
  and act on the window root.
- **One extension with a URI handler** reached through `code --open-url` — a URI
  handler returns nothing, so results would come back only by polling files.
- **Containing the build with `sandbox-exec`** — macOS does not apply a sandbox
  inside another, and the build's own tools (SwiftPM) sandbox themselves;
  turning theirs off for one build depends on Expo's script internals, Xcode's
  script-phase `PATH`, and an undocumented Xcode default.
- **Disabling SwiftPM's manifest sandbox through global Xcode defaults** — it
  weakens every Xcode build on the Mac.
- **Building as a dedicated low-privilege macOS user** — it needs a second
  account, a sudoers rule, and a root-owned wrapper installed with the admin
  password, a standing privileged path on the Mac; and the account's home
  persists, so one hostile build can poison the next.
- **`$SHELL -l` alone for the fix terminal** — it ignores a default terminal
  profile that differs from the login shell.
- **Only the user-level terminal profile settings** — they diverge from what VS
  Code launches for every other local terminal.
- **A `Pseudoterminal` running the fix commands** with the login environment —
  it has no pty, so the `sudo` prompts fail.
- **A bun check that picks the newest or the Homebrew bun** — `build` still runs
  the first bun on the login `PATH`.
- **A bare `bun upgrade` in the fix terminal** — the terminal's `PATH` can
  resolve a different bun.
- **`bun upgrade` for a Homebrew bun** — it overwrites the Cellar file and
  leaves Homebrew's version record wrong.
- **Sending the resolved bun path in the status result** — only the host acts on
  it, and it would change the protocol.
- **The host extension contributing the panel's views** — a `ui` extension's
  views can live in a view container that a `workspace` extension declares,
  hidden elsewhere by a `when` clause on a context key the container sets, but
  it moves UI to the host and changes what each extension does.
- **Diagnostics computed on the host** — its file rules let it read only
  `eas.json` and `app.json`, and it would publish diagnostics on files in the
  container.
- **`homebrew-core`'s `bun` for a fresh install** — `oven-sh/bun/bun` installs
  bun's own release builds, so its version tracks bun.sh.
