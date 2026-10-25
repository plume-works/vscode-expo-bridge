# Expo Bridge (Host)

The Mac-side half of [Expo Bridge](https://github.com/plume-works/vscode-expo-bridge).
Install the **Expo Bridge** extension pack rather than this extension directly.

This extension runs in the Mac's local extension host (`extensionKind: ["ui"]`). It
builds an Expo iOS app with `eas build --local`, installs and launches it on an iOS
Simulator it boots when none is running, and takes screenshots — for a devcontainer opened
on the Mac. A build runs project code on the Mac with your privileges, behind
per-workspace trust and a per-build confirmation.

A development build is reused when its native inputs — the project's `@expo/fingerprint`,
the profile, `eas.json`, `package.json`, the lockfile, and the eas-cli, Xcode, and extension
versions — match an earlier build of the same workspace folder, so a JavaScript-only change
skips the native build. `eas-host build <profile> --clean` forces a full build. Revoking a
workspace's trust deletes its stored builds.

Commands: set/clear `EXPO_TOKEN`, manage trusted workspaces, ask before every build again, and
fix missing tools.

A fix runs in a Mac terminal that opens with the Mac's default terminal profile
(`terminal.integrated.defaultProfile.osx`), or with your login shell when that profile is not
found on the Mac.

The bun fix upgrades the first `bun` on your login `PATH`, the one builds run: with
`brew upgrade bun` when Homebrew installed it, with that binary's own `bun upgrade` when the
bun.sh installer did, and otherwise not at all — the fix names the path for you to update. When
that bun comes before a newer one on the `PATH`, a notice says so once.
