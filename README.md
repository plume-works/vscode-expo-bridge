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
