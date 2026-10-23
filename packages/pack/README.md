# Expo Bridge

Build, install, launch, and screenshot an Expo iOS app on the Mac host from a devcontainer
opened by VS Code on a Mac, with EAS cloud as the fallback. The host extension runs in the
Mac's local extension host and the workspace extension in the container.

A devcontainer that lists this pack in `customizations.vscode.extensions` installs it in
the container, where the host extension shows as disabled: click its **Install Locally**
once per Mac, and **Reload Window** in windows already open. In a Codespace, run
**Developer: Reload Window** once so the workspace extension activates.

See the [protocol and security model](https://github.com/plume-works/vscode-expo-bridge).
