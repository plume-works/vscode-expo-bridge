# Expo Bridge

Build, install, launch, and screenshot an Expo iOS app on the Mac host from a devcontainer
opened by VS Code on a Mac, through a fixed, Expo-only action set. When the bridge is
unavailable, builds fall back to EAS cloud.

Install the **Expo Bridge** extension pack (`plume-works.vscode-expo-bridge`); it pulls in
both halves:

- **Host** (`plume-works.vscode-expo-bridge-host`, `extensionKind: ["ui"]`) runs in the
  Mac's local extension host: `eas build --local`, `xcrun simctl` install/launch/screenshot,
  per-workspace trust, and the per-build confirmation.
- **Workspace** (`plume-works.vscode-expo-bridge-workspace`, `extensionKind: ["workspace"]`)
  runs in the container: it installs the `eas-host` command and bridges it to the host.

Installing the pack from the Extensions view of an open Dev Containers window puts each half
in its place. A devcontainer that lists the pack in `customizations.vscode.extensions`
instead installs all three into the container, where the host extension cannot run: the
Extensions view shows it disabled with **Install Locally**. Click it once per Mac; windows
already open then offer **Reload Window**. A Codespace installs the listed extensions after
its window opens, so the workspace extension activates, and `eas-host` appears, only after
one **Developer: Reload Window**.

A window may hold several workspace folders, and several windows may share one container:
`eas-host` reaches the window it runs in and acts on the workspace folder containing its
working directory, so run it inside the Expo app's folder.

The bridge is a consent surface, not a security boundary — see the protocol and threat
model in `docs/protocol.md`.

## Setting up a project

The bridge needs nothing from the project beyond an Expo app with an `eas.json` build profile
for the iOS Simulator, linked to its EAS project (`eas init`, run once from the container).
In the project's `.devcontainer/devcontainer.json`, list the pack, forward Metro's port, and
keep VS Code's auto-forward notification for that port from covering the bridge's own:

```json
{
  "customizations": {
    "vscode": {
      "extensions": ["plume-works.vscode-expo-bridge"]
    }
  },
  "forwardPorts": [8081],
  "portsAttributes": {
    "8081": { "label": "Metro", "onAutoForward": "silent" }
  }
}
```

Write no trust or security setting into the project: a workspace is trusted only on the Mac,
when the bridge's first request asks. `EXPO_TOKEN` lives on the Mac too, in VS Code's secret
storage, set with **Expo Bridge: Set EXPO_TOKEN**.

The Mac needs Xcode with the iOS platform, CocoaPods, fastlane, Node, and a bun at least as
new as the container's. `eas-host status` reports each as a check; **Expo Bridge: Fix Missing
Tools** opens a Mac terminal with the commands that install what is missing, and the **Expo
Bridge** panel in the container shows the same checks with their fixes.

## Using `eas-host`

Run `eas-host` inside the Expo app's folder, in this order:

```bash
eas-host status            # exits 0 when the bridge is available
eas-host build <profile>   # builds the eas.json profile on the Mac; --clean forces a full build
eas-host install           # installs the newest build under .tmp/expo-bridge/
bunx expo start --dev-client --localhost --port 8081   # Metro, in the container
eas-host launch            # starts the app; a development build loads from Metro
eas-host screenshot        # writes a PNG under .tmp/expo-bridge/
```

Each result is one line of JSON on stdout, and build log lines stream to stderr. Exit codes:
`0` success, `1` the action failed, `2` a usage error, `3` the bridge is unavailable.
`eas-host --help` prints the same sequence. A development build whose native inputs are
unchanged reuses the folder's earlier artifact in under a second and reports `mode: "reused"`.

When `eas-host status` exits non-zero — a Codespace, a host other than a Mac, or the host
extension not installed — build the same profile on EAS cloud instead:
`bunx eas-cli@latest build -p ios --profile <profile>`. Device and store builds always go to
EAS cloud: the bridge builds only for the Simulator.

## VSCodium

VSCodium cannot use Microsoft's Dev Containers extension. The host extension finds the
workspace's Mac folder from a `dev-container+<hex>` remote authority carrying `hostPath`, so
only a dev container extension that produces that authority works with the bridge.

- **`s-h-a-d-o-w.dev-containers-oss` works.** On VSCodium 140 and later, add
  `"enable-proposed-api": ["s-h-a-d-o-w.dev-containers-oss"]` to `argv.json` (**Preferences:
  Configure Runtime Arguments**), then quit and restart VSCodium. The full action set, the
  trust prompt, the build confirmation, Metro on port 8081, and the one-click fix from the
  notification and the status bar item then work as in VS Code. The extension ignores the
  `"onAutoForward": "silent"` port attribute, so the forwarded-port notification for 8081
  still shows.
- **These do not work:**
  - `DDorch.codium-devcontainer` runs `postCreateCommand` as a Docker build step, before the
    workspace is mounted.
  - `mythreyak.open-remote-devcontainer` does not connect.
  - `3timeslazy.vscodium-devpodcontainers` and `zwhy2025.open-dev-container` connect over
    SSH, whose remote authority carries no Mac folder path.

## Layout

```
packages/
  protocol/    shared action, result, and error types; the protocol version
  host/        the ui-kind host extension
  workspace/   the workspace-kind extension and the eas-host CLI
  pack/        the extension pack listing both extensions
  release/     the version bump and release tag check
```

## Development

```bash
bun install
bun run lint        # prettier --check
bun run typecheck   # tsc across every package
bun test            # unit + CLI end-to-end tests
bun run package     # build and package all three VSIX
bun run bump        # next patch version for all three extensions
```

## Versioning

The pack and both extensions always carry the same version. An odd minor is a pre-release
line and an even minor a release, since the galleries accept only `major.minor.patch`.
Every change bumps the patch with `bun run bump`; `bun run bump <version>` starts a new
minor line.

## Releasing

Pushing a `vX.Y.Z` tag runs `.github/workflows/release.yml`. It refuses a tag that differs
from the extensions' version, packages an odd minor as a pre-release, and, once a reviewer
of the `release` environment approves, publishes to the Visual Studio Marketplace (Microsoft
Entra ID through GitHub OIDC) and Open VSX (trusted publishing through GitHub OIDC), with no
stored token, then creates the GitHub Release.

```bash
git tag v0.1.9 && git push origin v0.1.9   # on main, at the commit whose version is 0.1.9
```
