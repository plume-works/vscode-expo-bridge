# Agent instructions

Expo Bridge is a VS Code extension pack that builds, installs, launches, and screenshots an
Expo iOS app on the Mac that opened a devcontainer. `README.md` describes it for users;
`docs/protocol.md` is the contract between its two halves and its security model.

## Toolchain

JavaScript runs through `bun` and `bunx` only, never `npm`, `npx`, `yarn`, or `pnpm`.

```bash
bun install
bun run lint        # prettier --check
bun run typecheck   # tsc across every package
bun test            # unit + CLI end-to-end tests
bun run package     # build and package all three VSIX
bun run bump        # next patch version for all three extensions
```

Scope test runs to the file you are changing while iterating (`bun test <path>`). Scratch
files go in `./.tmp/` at the repository root (ignored by git).

## Rules every change keeps

- **Bump the patch.** Every change runs `bun run bump`; the pack and both extensions always
  share one version (`README.md`, Versioning).
- **The protocol is the contract.** A change to an action, a request or result field, an
  error, or the security model updates `docs/protocol.md` in the same change. Host and
  workspace extensions of different versions keep working within one protocol version; an
  incompatible change raises it.
- **A consent surface, not a security boundary.** The host extension accepts only the fixed
  action set, never runs a command string from the container, writes into the workspace
  only under `.tmp/expo-bridge/`, and reads no security setting from a file the container
  can write. `build` runs only behind the Mac-side trust prompt and the per-build
  confirmation. `docs/protocol.md`, Security model, states the full set.
- **No network port.** The container reaches the Mac only through VS Code command routing.

## Project memory

Design decisions, plans, bugs, and the backlog live in the IWE workspace under
`docs/knowledge/data/`; follow `docs/knowledge/AGENTS.md` when changing it. Run `iwe` from
the repository root, where `.iwe/` lives; document keys are relative to `docs/knowledge/`
(`data/plans/<slug>`). The `agentdev` plugin from
[plume-works/agent-devcontainer](https://github.com/plume-works/agent-devcontainer) provides
the IWE skills (`/agentdev:iwe-plan`, `/agentdev:iwe-implement`, …).

## Packaging the extensions for a manual test

Collect every packaged VSIX in one folder, `.tmp/vscode-exts/` at the repository root
(ignored by git), replacing what an earlier run left there:

```bash
bun run package
rm -rf .tmp/vscode-exts && mkdir -p .tmp/vscode-exts && cp packages/*/*.vsix .tmp/vscode-exts/
```

Hand the user the install command with the folder's path, run in a terminal on the Mac:

```bash
find .tmp/vscode-exts/ -name '*.vsix' | xargs -I{} code --install-extension {} --force
```

The host extension is ui-kind, so the Mac install is the one that takes effect. The
workspace extension runs in the container: when the change touches `packages/workspace`, the
user also installs `vscode-expo-bridge-workspace.vsix` from a terminal inside the Dev
Containers window, from a path that container can read.
