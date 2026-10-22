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

The bridge is a consent surface, not a security boundary — see the protocol and threat
model in `docs/protocol.md`.

## Layout

```
packages/
  protocol/    shared action, result, and error types; the protocol version
  host/        the ui-kind host extension
  workspace/   the workspace-kind extension and the eas-host CLI
  pack/        the extension pack listing both extensions
  release/     the version bump script
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
