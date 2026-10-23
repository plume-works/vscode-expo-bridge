# Expo Bridge protocol and security model

The bridge lets a devcontainer opened by VS Code on a Mac build, install, launch, and
screenshot an Expo iOS app on that Mac. This document is the contract between the
container-side `eas-host` command and the Mac-side host extension, and the security model
both halves implement. The types in `packages/protocol/src/index.ts` are its machine form.

## Security model

The bridge is a **consent surface for a cooperative container, not a security boundary**.

A devcontainer window already gives the container reach onto the Mac that no extension can
take away: through VS Code's own commands a container-side extension opens a local terminal
and runs commands on the Mac, and the SSH and GPG agents are forwarded into the container.
The bridge adds no reach beyond that. It does not defend against a hostile container, and
nothing it installs could.

What the bridge does guarantee is that its own privileged action happens only with the Mac
user's consent:

- **Per-workspace trust, granted only on the Mac.** The first request from a workspace with
  no recorded decision shows a modal naming the workspace's host path. "Allow" records
  trust; any other answer records a decline. Both are stored in the host extension's
  `globalState`, keyed by host path. A declined workspace fails every request without
  prompting again until the decision is revoked with **Expo Bridge: Manage Trusted
  Workspaces**, which lists and revokes allowed and declined workspaces alike.
- **A confirmation before every `build`.** The modal names the profile and states that
  project code will run on the Mac with the user's privileges. Its answers are "Allow
  once", "Allow and don't ask for an hour", and "Allow and don't ask today". A cooldown
  applies to that workspace only and is stored in `globalState`. No other action prompts beyond trust.
- **Nothing the container writes configures the bridge.** Trust, cooldowns, and the token
  are never read from workspace settings, `devcontainer.json`, or any other file the
  container can write.
- **Every invocation is treated as possibly the container's.** VS Code passes a command
  handler nothing that identifies the calling extension or host, so pairing the two
  extensions is not a boundary. The host resolves the workspace from its own window's remote
  authority, never from a path the request supplies.
- **The build is not contained.** `build` runs `eas build --local` as the Mac user,
  unsandboxed. Project code in it — lifecycle scripts, `eas-build-*` hooks, `app.config.js`,
  config plugins, the `Podfile`, Xcode build phases — can do anything the user can. Trust
  and the build confirmation are the only gate on it.
- **No project code outside `build`.** The host extension reads `eas.json` and `app.json`
  as JSON only, refusing a symlink, a non-regular file, or a file over 1 MiB, and never
  evaluates a project file as code. No error returned to the container quotes the contents
  of a file the host read.
- **Management commands change nothing on their own.** Setting or clearing the token,
  managing trust, and the one-click fix take no arguments, return nothing, and act only
  after the user answers a prompt — even when a container-side extension invokes them.
- **`EXPO_TOKEN` lives in VS Code SecretStorage** on the Mac and is placed in the build's
  environment only. The build can read it, so use a robot-account token scoped to the
  project.

## Transport

```
eas-host ──unix socket──▶ workspace extension ──executeCommand──▶ host extension
(container)  /tmp/vscode-expo-bridge.sock    expoBridge.ui.dispatch     (Mac)
```

- `eas-host` writes one request as a single line of JSON to
  `/tmp/vscode-expo-bridge.sock`, which the workspace extension serves inside the
  container. One VS Code window serves one container.
- The workspace extension forwards the request unchanged to the `ui`-side command
  `expoBridge.ui.dispatch` and answers with newline-delimited JSON frames:
  - `{"kind":"log","line":"…"}` — one build log line, zero or more, only during `build`;
  - `{"kind":"response","response":…}` — exactly one, last.
- A response is `{"ok":true,"result":…}` or `{"ok":false,"error":{"code":…,"message":…}}`.

The protocol travels over VS Code's command routing; it opens no network port.

## Actions

The host accepts exactly these five actions. It never runs a command string from the
container, and any other `action` is answered with `bad-request`.

| Action       | Request fields                  | Result                              | Prompts                   |
| ------------ | ------------------------------- | ----------------------------------- | ------------------------- |
| `status`     | `containerBunVersion?` (string) | `StatusResult`                      | trust, when undecided     |
| `build`      | `profile` (string)              | `{ artifactRel, logRel, exitCode }` | trust, build confirmation |
| `install`    | `artifactRel` (string)          | `{ bundleIdentifier }`              | trust                     |
| `launch`     | —                               | `{ bundleIdentifier }`              | trust                     |
| `screenshot` | —                               | `{ screenshotRel }`                 | trust                     |

### `status`

Reports whether the bridge can serve a build. `available` is true only on a macOS host
whose copy of the workspace exists at the host path; otherwise the tool checks are skipped
and reported as failing. When available and the workspace has no trust decision, `status`
asks for trust and reports the answer rather than failing.

`checks` holds one `{ ok, detail? }` per item: `macHost`, `hostPathExists`,
`workspaceTrusted`, `xcode` (a full Xcode that runs `xcodebuild`), `cocoapods`,
`fastlane`, `node`, `easCli` (the eas-cli version `build` runs; fails when `eas.json`'s
`cli.version` is not a version range), `bun` (present on the Mac and at least as new as
`containerBunVersion`), `expoToken` (stored in SecretStorage), `easProjectId`
(`extra.eas.projectId` in `app.json`), `simulator` (a simulator is booted, or one can be
booted on demand; the detail names the device that would boot), and `port8081Forwarded`
(`127.0.0.1:8081` on the Mac accepts a connection).

`protocolVersion` carries the host's protocol version, currently `1`.

### `build`

`profile` must match `^[A-Za-z0-9_-]+$` and name a profile under `build` in the
workspace's `eas.json`. After trust and the confirmation, the host runs

```
bunx eas-cli@<spec> build --local --non-interactive -p ios --profile <profile>
```

with the Mac's bun. `<spec>` is `cli.version` from the workspace's `eas.json`, Expo's own
pin for the CLI, with the spaces after its operators removed (`>= 16.0.0` runs
`eas-cli@>=16.0.0`). It must be a semver version or range; anything else (`file:`, git,
URL, alias, dist-tag) fails the build with `bad-argument`. With no `cli.version`, `<spec>`
is `latest`. eas-cli is never taken from the project's dependencies, which `expo doctor`
flags. The build runs in the workspace's host path, with the user's login environment plus `EXPO_TOKEN` from
SecretStorage, `EAS_NO_VCS=1`, `CI=1`, and `EAS_LOCAL_BUILD_ARTIFACTS_DIR` set to a fresh
directory in the host extension's private global storage. The log streams into a fresh
`.tmp/expo-bridge/build-<ms>.log` while the build runs; `eas-host` tails it. The artifact
is copied into `.tmp/expo-bridge/` when the build ends. A build that exits non-zero still
succeeds as an action and reports its `exitCode`; `artifactRel` is empty when no artifact
was produced. The host never runs `eas init`.

### `install`

`artifactRel` is a workspace-relative path that must resolve under `.tmp/expo-bridge/`.
The host unpacks it with `tar -xk` into a fresh directory in its private global storage —
bsdtar refuses `..` entries and strips a leading `/` — and rejects the artifact when any
symlink landed in the tree. It reads `CFBundleIdentifier` from the `.app`'s `Info.plist`
through `plutil`, rejects a value outside `^[A-Za-z0-9][A-Za-z0-9.-]*$`, and installs the
`.app` on the simulator with `xcrun simctl install <udid>`.

### The simulator

`install`, `launch`, and `screenshot` act on one simulator, addressed by UDID. When one is
booted, they use it. Otherwise the host boots, headless, an available iPhone on the newest
available iOS runtime, creating `expo-bridge <device type>` from that runtime's newest
iPhone type when none exists, and waits with `xcrun simctl bootstatus <udid> -b` until it
has booted. With no available iOS runtime the action fails with `action-failed`.

### `launch`

Starts the app `install` last installed in this VS Code session. A development build —
one whose `Info.plist` declares an expo-dev-client scheme, `exp+` followed by a plain name —
is restarted with

```
xcrun simctl launch --terminate-running-process <udid> <bundle id> --initialUrl http://localhost:8081 \
  -EXDevMenuIsOnboardingFinished YES -EXDevMenuShowsAtLaunch NO
```

so expo-dev-client loads the bundle from Metro over the forwarded port without a tap, and
neither expo-dev-menu's introduction nor the menu covers the app. The
URL is fixed by the host; the container supplies none of it. Opening the URL through
`simctl openurl` instead would stop at an iOS "Open in" prompt. Any other app is launched
with `xcrun simctl launch <udid> <bundle id>`. Fails with `not-found` when nothing was
installed.

### `screenshot`

Captures the simulator with `xcrun simctl io <udid> screenshot` into private storage,
then copies the PNG to a fresh `.tmp/expo-bridge/screenshot-<ms>.png`.

## Paths and the write boundary

- Every path in a request is **workspace-relative**. An absolute path, a `..` component,
  or a resolved path that leaves the workspace fails with `path-escape`. Every component is
  checked with `lstat`, and any symlink fails with `symlink-rejected`.
- The host writes into the workspace **only under `.tmp/expo-bridge/`**: build logs,
  artifacts, and screenshots. Each file is created under a fresh name with
  `O_CREAT | O_EXCL | O_NOFOLLOW_ANY`, so an existing file or a symlink anywhere in the path
  fails the write. Tools never write into the workspace directly; they write into the host
  extension's private global storage, and the host copies the result in under this rule.
- `EAS_NO_VCS=1` keeps eas-cli out of the workspace's `.git`; its archive still honors
  `.gitignore` and includes uncommitted and untracked files.
- The host starts every process with `execFile` and an argument array, never a shell
  string, using the login environment captured per request with `$SHELL -l -c 'env -0'` plus
  `/opt/homebrew/bin` and `/usr/local/bin` for tool lookup.

## Errors

| Code               | Meaning                                                         |
| ------------------ | --------------------------------------------------------------- |
| `untrusted`        | the workspace is not trusted on the Mac                         |
| `build-declined`   | trust or the build confirmation was declined                    |
| `unavailable`      | no resolvable host path for this window                         |
| `bad-request`      | a malformed request or an unknown action                        |
| `bad-argument`     | an argument failed validation (profile name, bundle id)         |
| `path-escape`      | a path is absolute or resolves outside its allowed root         |
| `symlink-rejected` | a path component, or an unpacked artifact entry, is a symlink   |
| `not-found`        | a referenced file, profile, `.app`, or installed app is missing |
| `action-failed`    | the underlying tool failed                                      |

`message` is for humans and never contains file contents.

## `eas-host`

```
eas-host status | build <profile> | install <path> | launch | screenshot
```

The workspace extension installs it into `~/.local/bin` when it activates in a workspace
containing `eas.json`. It prints the result or error object as one line of JSON on stdout
and build log lines on stderr. Exit codes:

| Exit | Meaning                                                                                                                                 |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------- |
| 0    | the action succeeded (for `status`: the bridge is available)                                                                            |
| 1    | the action failed                                                                                                                       |
| 2    | a usage error                                                                                                                           |
| 3    | the bridge is unavailable: no socket, an `unavailable` error, a `status` with `available: false`, or a host on another protocol version |

On a protocol version mismatch `eas-host status` names both versions on stderr. An agent
treats any non-zero `eas-host status` as "use EAS cloud".

## Fixes are not protocol actions

When `status` finds a tool the one-click fix can install, the host extension shows a status
bar item in the Mac window naming the number of fixes, with each failing check's detail in
its tooltip, and a notification with a **Fix…** button whenever the set of failing checks
changes. It stays until a later `status` finds nothing to fix. Clicking it, or running
**Expo Bridge: Fix Missing Tools**, opens a picker that stays open when focus moves; only
picking a fix there starts one, and only one runs at a time: Homebrew installs in a visible
local terminal, and for Xcode the App Store page followed by `xcode-select`, the license
acceptance, and `xcodebuild -downloadPlatform iOS`. While a fix runs, the status bar item
shows it running and offers nothing to click; when its commands finish, or its terminal
closes, the host re-runs `status` and the item clears or shows what still fails. No protocol
action can start a fix.
