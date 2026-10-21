# Expo Bridge (Host)

The Mac-side half of [Expo Bridge](https://github.com/plume-works/vscode-expo-bridge).
Install the **Expo Bridge** extension pack rather than this extension directly.

This extension runs in the Mac's local extension host (`extensionKind: ["ui"]`). It
builds an Expo iOS app with `eas build --local`, installs and launches it on the booted
iOS Simulator, and takes screenshots — for a devcontainer opened on the Mac. A build runs
project code on the Mac with your privileges, behind per-workspace trust and a per-build
confirmation.

Commands: set/clear `EXPO_TOKEN`, manage trusted workspaces, and fix missing tools.
