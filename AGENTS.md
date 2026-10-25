# Agent instructions

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
