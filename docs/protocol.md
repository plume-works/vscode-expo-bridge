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
  Workspaces**, which lists and revokes allowed and declined workspaces alike. Revoking a
  host path's decision also deletes the build cache of every folder under it.
- **A confirmation before every `build`.** The modal names the profile and the folder's
  Mac path, and states that project code will run on the Mac with the user's privileges.
  It names a clean build when `clean` is set, and otherwise says a matching earlier build
  may be reused.
  Its answers are "Allow once", "Allow and don't ask for an hour", and "Allow and don't ask
  today". A cooldown applies to that workspace's host path, whichever of its folders
  builds, and is stored in `globalState`; **Expo Bridge: Ask Before Every Build** ends it
  without touching trust, and revoking trust ends it too. No other action prompts beyond
  trust.
- **Nothing the container writes configures the bridge.** Trust, cooldowns, and the token
  are never read from workspace settings, `devcontainer.json`, or any other file the
  container can write.
- **Every invocation is treated as possibly the container's.** VS Code passes a command
  handler nothing that identifies the calling extension or host, so pairing the two
  extensions is not a boundary. The host resolves the workspace's host path from its own
  window's remote authority, and trust is keyed to it. A request may choose only one of its
  window's workspace folders, which the host maps through Docker to a Mac path at or under
  that host path (see [The workspace folder](#the-workspace-folder)); it can name no folder
  outside it.
- **The build is not contained.** `build` runs `eas build --local` as the Mac user,
  unsandboxed. Project code in it — lifecycle scripts, `eas-build-*` hooks, `app.config.js`,
  config plugins, the `Podfile`, Xcode build phases — can do anything the user can. Trust
  and the build confirmation are the only gate on it.
- **No project code outside `build`.** The host extension reads `eas.json` and `app.json`
  as JSON only, refusing a symlink, a non-regular file, or a file over 1 MiB, and never
  evaluates a project file as code. The fingerprint step that decides reuse evaluates
  project code, so it runs only inside a `build` that passed trust and the confirmation,
  never in `status` or another action. No error returned to the container quotes the contents
  of a file the host read.
- **Management commands change nothing on their own.** Setting or clearing the token,
  managing trust, asking before every build again, and the one-click fix take no arguments,
  return nothing, and act only after the user answers a prompt — even when a
  container-side extension invokes them.
- **`EXPO_TOKEN` lives in VS Code SecretStorage** on the Mac and is placed in the build's
  environment only. The build can read it, so use a robot-account token scoped to the
  project.

## Transport

```
eas-host ──unix socket──▶ workspace extension ──executeCommand──▶ host extension
(container)  /tmp/vscode-expo-bridge/<id>.sock  expoBridge.ui.dispatch  (Mac)
```

- Several VS Code windows can share one container, so each window's workspace extension
  serves its own socket, `/tmp/vscode-expo-bridge/<id>.sock` with a random `<id>`, next to
  `<id>.json`, its registry entry: `{ pid, activatedAt, folders }`, the extension host's
  process id, its activation time in epoch milliseconds, and the container paths of the
  window's workspace folders. The entry is rewritten when the folders change. The
  directory is created with mode `0700`, and an entry the current user does not own is
  ignored. On disposal a window removes only its own two files; on activation it removes
  the entries whose process no longer exists.
- `eas-host` reads the live entries and connects to the window with the longest workspace
  folder containing its real working directory, the most recently activated on a tie. It
  writes one request as a single line of JSON, carrying that directory as `cwd`.
- The workspace extension resolves `cwd` to its own longest workspace folder containing it,
  replaces `cwd` with that folder's container path as `folder`, and forwards the request to
  the `ui`-side command `expoBridge.ui.dispatch`. A `cwd` outside every folder answers
  `unavailable`. It answers `eas-host` with newline-delimited JSON frames:
  - `{"kind":"log","line":"…"}` — one build log line, zero or more, only during `build`;
  - `{"kind":"response","response":…}` — exactly one, last.
- A response is `{"ok":true,"result":…}` or `{"ok":false,"error":{"code":…,"message":…}}`.

The protocol travels over VS Code's command routing; it opens no network port.

## Actions

The host accepts exactly these five actions. It never runs a command string from the
container, and any other `action` is answered with `bad-request`. Every request also
carries `folder` (string), the container path of the workspace folder it acts on; a
request without an absolute `folder` is answered with `bad-request`.

| Action       | Request fields                         | Result                                                              | Prompts                   |
| ------------ | -------------------------------------- | ------------------------------------------------------------------- | ------------------------- |
| `status`     | `containerBunVersion?` (string)        | `StatusResult`                                                      | trust, when undecided     |
| `build`      | `profile` (string), `clean?` (boolean) | `{ artifactRel, logRel, exitCode, mode?, reason?, reusedBuiltAt? }` | trust, build confirmation |
| `install`    | `artifactRel` (string)                 | `{ bundleIdentifier }`                                              | trust                     |
| `launch`     | —                                      | `{ bundleIdentifier }`                                              | trust                     |
| `screenshot` | —                                      | `{ screenshotRel }`                                                 | trust                     |

### The workspace folder

Before any action, the host maps the request's `folder` to the Mac path the action uses:

1. it resolves the trusted host path from its own window's remote authority;
2. it requires `folder` to be one of its own window's workspace folders;
3. it finds the window's container with `docker ps`, filtered on the
   `devcontainer.local_folder=<host path>` label Dev Containers sets, and also on
   `devcontainer.config_file=<path>` when the authority names its `configFile`, against
   the Docker daemon in the authority's `settings.host` when present (a socket path is
   passed as `unix://<path>`), and requires exactly one running container;
4. it reads that container's bind mounts with `docker inspect`, takes the one whose
   destination is the longest path-component prefix of `folder`, and appends the rest of
   `folder` to its source, read as a Mac path: Docker Desktop reports a source from the
   Mac under its VM's `/host_mnt`, which the host removes;
5. it accepts the result only when it is the host path or lies under it, with no symlink
   component below the host path.

Any failure — no `docker`, no daemon, zero or several containers, no bind mount, a result
outside the host path — makes `status` report `available: false` and every other action
fail with `unavailable`; the host never falls back to the host path. The container is
looked up on every request. `docker` is the user-level `dev.containers.dockerPath` value
when set, otherwise `docker` on the login environment's `PATH`, the Homebrew prefixes, or
`~/.docker/bin`; a workspace-level value is never read, since the container can write
workspace settings. `docker ps` and `docker inspect` are read-only and run as argument
arrays.

Every action then works in the folder's Mac path: `status` reads `eas.json` and `app.json`
there, `build` runs there, and every write lands in its `.tmp/expo-bridge/`.

### `status`

Reports whether the bridge can serve a build in the request's folder. `available` is true
only on a macOS host whose copy of the workspace exists at the host path and whose
`folder` maps under it; otherwise the tool checks are skipped and reported as failing.
`folderHostPath` is the folder's Mac path, which the checks inspected, and is empty when
the folder does not map. When available and the workspace has no trust decision, `status`
asks for trust and reports the answer rather than failing.

`checks` holds one `{ ok, detail? }` per item: `macHost`, `hostPathExists`,
`workspaceMapped` (the folder maps to a Mac path; the detail says why not),
`workspaceTrusted`, `xcode` (a full Xcode that runs `xcodebuild`), `cocoapods`,
`fastlane`, `node`, `easCli` (the eas-cli version `build` runs; fails when `eas.json`'s
`cli.version` is not a version range), `bun` (present on the Mac and at least as new as
`containerBunVersion`), `expoToken` (stored in SecretStorage), `easProjectId`
(`extra.eas.projectId` in `app.json`), `simulator` (a simulator is booted, or one can be
booted on demand; the detail names the device that would boot), and `port8081Forwarded`
(`127.0.0.1:8081` on the Mac accepts a connection).

The workspace extension replaces `easProjectId` in every `status` result it relays, to
`eas-host` or to its own panel, with the container's resolution of the folder's app config:
the folder's own `node_modules/.bin/expo config --json --type public`, which evaluates
`app.config.js` or `app.config.ts`, or `app.json` read as JSON when there is no local `expo`
and no dynamic config. A dynamic config without a local `expo` reports the check as failing
with a detail saying it could not be resolved. Evaluating the config in the container runs
only the container's own code; the host still evaluates no project code to answer `status`.

`protocolVersion` carries the host's protocol version, currently `2`.

### `build`

`profile` must match `^[A-Za-z0-9_-]+$` and name a profile under `build` in the
folder's `eas.json`. After trust and the confirmation, the host runs

```
bunx eas-cli@<spec> build --local --non-interactive -p ios --profile <profile>
```

with the Mac's bun. `<spec>` is `cli.version` from the folder's `eas.json`, Expo's own
pin for the CLI, with the spaces after its operators removed (`>= 16.0.0` runs
`eas-cli@>=16.0.0`). It must be a semver version or range; anything else (`file:`, git,
URL, alias, dist-tag) fails the build with `bad-argument`. With no `cli.version`, `<spec>`
is `latest`. eas-cli is never taken from the project's dependencies, which `expo doctor`
flags. The build runs in the folder's Mac path, with the user's login environment plus `EXPO_TOKEN` from
SecretStorage, `EAS_NO_VCS=1`, `CI=1`, and `EAS_LOCAL_BUILD_ARTIFACTS_DIR` set to a fresh
directory in the host extension's private global storage. The log streams into a fresh
`.tmp/expo-bridge/build-<ms>.log` while the build runs; `eas-host` tails it. The artifact
is copied into `.tmp/expo-bridge/` when the build ends. A build that exits non-zero still
succeeds as an action and reports its `exitCode`; `artifactRel` is empty when no artifact
was produced. The host never runs `eas init`.

#### Reuse of a matching development build

A development build loads its JavaScript from Metro, so its artifact depends only on native
inputs. Without `clean`, after the profile and eas-cli checks, the host computes a cache key
and returns the folder's stored artifact when an entry for that key exists, without running
eas-cli:

1. **The fingerprint step.** The host runs a fixed script with the Mac's `node`, in the
   folder's Mac path, that loads the project's own `expo/fingerprint` — as eas-cli does
   inside every build — and prints the hash of
   `createFingerprintAsync(<folder's Mac path>, { platforms: ["ios"] })`. A missing `node`,
   a non-zero exit, or output that is not one lowercase 40-digit hex hash means no
   fingerprint.
2. **The cache key** is the SHA-256 of a record naming the fingerprint hash, the profile,
   the SHA-256 of `eas.json`, `package.json`, and each present lockfile (`bun.lock`,
   `bun.lockb`, `package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`), the output of
   `bunx eas-cli@<spec> --version`, the output of `xcodebuild -version`, and the host
   extension's version. Each file is read as bytes from the folder's Mac path and refused
   when a path component is a symlink, the file is not regular, or it is over 64 MiB. A
   refusal, a missing `eas.json` or `package.json`, or a failed version probe means no key.
3. **The cache** lives in the host extension's private global storage under
   `build-cache/<sha256 of the host path>/<sha256 of the folder's Mac path>/`: an
   `index.json` recording both paths and, per key, the artifact file and when it was
   built, plus one artifact per key. The directory comes from the trusted host path and the
   mapped folder only; the container never names a cache directory or a key. Each folder
   keeps its five newest entries, so two apps under one host path never share one.

On a hit, the host copies the stored artifact into a fresh
`.tmp/expo-bridge/build-<ms>.tar.gz`, so `eas-host install` with no path picks it, and
returns `mode: "reused"`, `exitCode: 0`, and `reusedBuiltAt`, the epoch milliseconds the
stored build ran. Otherwise it runs the build above and returns `mode: "built"` with a
`reason`: `no-match` when no entry has the key, `no-fingerprint` when there is no
fingerprint or no key, and `clean-requested` when `clean` is set. With `clean` the host
skips the lookup and computes the key after the build.

A build that exited 0 and produced an artifact is stored under its key, unless `tar -tzf`
cannot list the artifact or it contains a `main.jsbundle` — a build that embeds its
JavaScript bundle, such as a Release build, is never stored or reused. The artifact and
`index.json` are written through a temporary file and a rename, so no reader sees a partial
entry. The copy and the update of `index.json` hold `index.lock` in the folder's cache
directory, a file created with `O_CREAT | O_EXCL` that names its process, so builds in one
folder — from one VS Code window or several, each its own host extension process — never
drop each other's entries; the build itself never holds it. A lock whose process no longer
exists, or that is older than 60 s, is taken over. A build that cannot take the lock within
10 s stores nothing, and its log says so. Every build, reused or not, writes its log, which
names the fingerprint hash, the key, and the outcome, and never a file's contents.

The fingerprint is a correctness hint, not a security input: project code
(`app.config.js`, `fingerprint.config.js`) can force a match, and the worst outcome is a
stale artifact this folder's own confirmed build produced. Inputs outside the key — EAS
server-side environment variables, the Mac login environment, the macOS and simulator
runtime versions — need `clean` after they change.

The protocol version stays `2`: a host without reuse ignores `clean` and always builds in
full, which is what `clean` asks for, and an `eas-host` without reuse ignores `mode`,
`reason`, and `reusedBuiltAt`.

### `install`

`artifactRel` is a folder-relative path that must resolve under `.tmp/expo-bridge/`.
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

- Every path in a request is **relative to the folder's Mac path**. An absolute path, a
  `..` component, or a resolved path that leaves the folder fails with `path-escape`. Every component is
  checked with `lstat`, and any symlink fails with `symlink-rejected`.
- The host writes into the workspace **only under the folder's `.tmp/expo-bridge/`**: build logs,
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

| Code               | Meaning                                                                                                      |
| ------------------ | ------------------------------------------------------------------------------------------------------------ |
| `untrusted`        | the workspace is not trusted on the Mac                                                                      |
| `build-declined`   | trust or the build confirmation was declined                                                                 |
| `unavailable`      | no resolvable host path, or the folder is outside every workspace folder or does not map under the host path |
| `bad-request`      | a malformed request, an unknown action, or no `folder`                                                       |
| `bad-argument`     | an argument failed validation (profile name, bundle id)                                                      |
| `path-escape`      | a path is absolute or resolves outside its allowed root                                                      |
| `symlink-rejected` | a path component, or an unpacked artifact entry, is a symlink                                                |
| `not-found`        | a referenced file, profile, `.app`, or installed app is missing                                              |
| `action-failed`    | the underlying tool failed                                                                                   |

`message` is for humans and never contains file contents.

## `eas-host`

```
eas-host status | build <profile> [--clean] | install [path] | launch | screenshot | --help
```

The workspace extension installs it into `~/.local/bin` when it activates in a workspace
containing `eas.json`. Run it inside the Expo app's workspace folder: it acts on the
workspace folder that contains its working directory, so an app in a subdirectory is added
to the window as a workspace folder of its own. It prints the result or error object as one
line of JSON on stdout and build log lines on stderr.

An agent runs the actions in order: `status`, `build <profile>`, `install`, `launch`,
`screenshot`. `build` returns the artifact's folder-relative path under
`.tmp/expo-bridge/` as `artifactRel`, reusing an earlier development build when its native
inputs are unchanged (`mode: "reused"`); `build <profile> --clean` sends `clean: true` for a
full build, and any other argument after the profile is a usage error. `install` with no path installs the newest build
artifact there — the newest file that is neither a `build-*.log` nor a `screenshot-*.png`;
the workspace extension resolves it before forwarding, so the host always receives a path,
and with no artifact it answers `not-found`. `launch` of a development build loads the
bundle from Metro on port 8081, so Metro runs in the container first
(`bunx expo start --dev-client --localhost --port 8081`). `eas-host --help` (also `-h` or
`help`) prints this sequence on stdout and exits 0.

Exit codes:

| Exit | Meaning                                                                                                                                                                                                     |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0    | the action succeeded (for `status`: the bridge is available)                                                                                                                                                |
| 1    | the action failed                                                                                                                                                                                           |
| 2    | a usage error                                                                                                                                                                                               |
| 3    | the bridge is unavailable: no window with a workspace folder containing the working directory, no socket, an `unavailable` error, a `status` with `available: false`, or a host on another protocol version |

With no such window `eas-host` names its working directory on stderr. On a protocol
version mismatch `eas-host status` names both versions on stderr. An agent
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

The workspace extension's panel and its Problems quick fixes start a fix only by running
`expoBridge.fix` with no arguments, which opens the same picker on the Mac; the picker still
decides what runs. They reach the token and trust only through `expoBridge.setToken` and
`expoBridge.manageTrust`, also without arguments, and a build from the panel sends the same
`build` request as `eas-host build`, behind the same trust and confirmation.
