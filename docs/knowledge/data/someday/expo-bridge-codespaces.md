---
type: someday
description: Let the VS Code Expo bridge build on the Mac for a Codespace opened from VS Code on that Mac, by packing the workspace in the container and sending it, and the results back, over VS Code's command routing instead of a shared folder.
generated:
  by: claude-code/opus-5.5
  at: 2026-10-23T09:00:00Z
sources:
- resource: docs/knowledge/data/plans/20261015-vscode-expo-bridge.md
- resource: https://github.com/plume-works/vscode-expo-bridge
---

# Build on the Mac for a Codespace through the Expo bridge

The [VS Code Expo bridge](../plans/20261015-vscode-expo-bridge.md) builds on the
Mac only for a local Dev Containers window: the host extension finds the
workspace's folder on the Mac, builds from it, and returns the log, the `.app`
archive, and screenshots through `.tmp/expo-bridge/` in that shared folder. A
Codespace opened from VS Code on a Mac has the same host extension, simulator,
and port 8081 forwarding, but no shared folder, so `eas-host status` reports the
bridge unavailable and agents build on EAS cloud.

The approach the user chose: the workspace extension packs the working tree in
the container, as eas-cli does for a cloud build (uncommitted and untracked
files included, `.gitignore` honored), and sends it to the host extension over
VS Code's command routing; the host extension builds from a private directory on
the Mac and returns the log, artifact, and screenshots the same way. Rejected:
having the Mac clone the repository and branch — it builds only what was pushed,
and lets the container choose what code the Mac fetches and runs.

What research would settle:

- Whether VS Code command routing carries a project archive and an `.app`
  archive of tens of MB, and at what chunk size.
- What keys per-workspace trust when there is no Mac folder, such as the
  Codespace name.
- How the build log streams back without a shared file to tail.

Closing this idea means a plan once Codespaces from a Mac become a workflow
someone uses, or a recorded decision that EAS cloud stays the Codespace path.
