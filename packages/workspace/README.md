# Expo Bridge (Workspace)

The container-side half of [Expo Bridge](https://github.com/plume-works/vscode-expo-bridge).
Install the **Expo Bridge** extension pack rather than this extension directly.

This extension runs in the devcontainer (`extensionKind: ["workspace"]`). It installs the
`eas-host` command into `~/.local/bin` and bridges it to the Mac-side host extension. Run
`eas-host status` to see whether the bridge is available; when it is not, use EAS cloud.
`eas-host --help` lists the actions in the order an agent runs them.
