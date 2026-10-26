# Expo Bridge (Workspace)

The container-side half of [Expo Bridge](https://github.com/plume-works/vscode-expo-bridge).
Install the **Expo Bridge** extension pack rather than this extension directly.

This extension runs in the devcontainer (`extensionKind: ["workspace"]`). It installs the
`eas-host` command into `~/.local/bin` and bridges it to the Mac-side host extension. Run
`eas-host status` to see whether the bridge is available; when it is not, use EAS cloud.
`eas-host --help` lists the actions in the order an agent runs them.

## Panel, status bar, and Problems

- **The Expo Bridge panel** in the activity bar shows each Expo folder's last status:
  Connection, Mac tools, Project, Trust & token, and Simulator. It runs one status the first
  time it is opened in a window; **Re-run Status** runs another, and every `eas-host status`
  updates it. Before a status, without the Mac half, or when the bridge is unavailable, it
  says what that means. Drag it to the bottom panel or the secondary sidebar like any view.
- **Build** builds the folder's remembered profile, asking once and remembering the answer
  per folder; **Change Build Profile** asks again, and **Clean Build** builds in full. The log
  streams to the **Expo Bridge Build** output channel.
- **Fix…**, **Set EXPO_TOKEN**, and **Manage Trust** open the Mac half's own picker and
  prompts; nothing runs on the Mac without a click there.
- **The status bar item** reads `Expo Bridge: OK`, `N issues`, `unavailable`,
  `Mac half not installed`, or `not checked`, and opens the panel.
- **Problems** lists every failing check on `eas.json`, the app config, or `cli.version`,
  plus two container checks: a build profile with `ios.simulator: true`, and the remembered
  profile still existing. Quick fixes run the Mac fix, set the token, manage trust, link the
  EAS project with `eas init` (static `app.json` only), start Metro in the container, add a
  simulator build profile, or pick the build profile again.
- **The EAS project ID** is resolved in the container from the app config as Expo resolves
  it, so `app.config.js` and `app.config.ts` count; `eas-host status` reports the same answer.
