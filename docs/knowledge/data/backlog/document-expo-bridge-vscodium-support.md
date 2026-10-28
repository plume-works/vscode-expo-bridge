---
type: task
created: 2026-10-23
stage: done
priority: medium
description: Document in the plume-works/vscode-expo-bridge README which VSCodium dev container extension works with the Expo bridge, the runtime argument it needs, and which extensions do not work.
generated:
  by: claude-code/opus-5.5
  at: 2026-10-25T12:00:00Z
sources:
- resource: https://github.com/plume-works/vscode-expo-bridge
- resource: https://github.com/s-h-a-d-o-w/dev-containers-oss
- resource: https://open-vsx.org/extension/s-h-a-d-o-w/dev-containers-oss
- resource: docs/knowledge/data/plans/20261015-vscode-expo-bridge.md
- resource: https://github.com/plume-works/vscode-expo-bridge/pull/23
completed: 2026-10-25
---

# Document VSCodium support for the Expo bridge

The [bridge plan](../plans/20261015-vscode-expo-bridge.md) targets VS Code with
Microsoft's Dev Containers extension, which VSCodium cannot use. The pack is on
Open VSX, so VSCodium users can install it, but nothing tells them which dev
container extension the bridge works with. The host extension finds the
workspace's Mac folder by decoding a `dev-container+<hex>` remote authority
whose payload carries `hostPath` (`packages/host/src/hostpath.ts`), so only an
extension that produces that authority can work.

Add a VSCodium section to the sibling repository's `README.md` stating:

- `s-h-a-d-o-w.dev-containers-oss` works. On VSCodium 140 and later it needs
  `"enable-proposed-api": ["s-h-a-d-o-w.dev-containers-oss"]` in `argv.json`
  (**Preferences: Configure Runtime Arguments**), then a full restart. With it,
  the bridge's full action set, the trust prompt, the build confirmation, Metro
  over port 8081, and the one-click fix from the notification and the status bar
  item work as in VS Code.
- That extension ignores the `portsAttributes` `"onAutoForward": "silent"` entry
  for port 8081, so the forwarded-port notification still shows.
- These do not work:
  - `DDorch.codium-devcontainer` — runs `postCreateCommand` as a Docker build
    step, before the workspace is mounted.
  - `mythreyak.open-remote-devcontainer` — does not connect.
  - `3timeslazy.vscodium-devpodcontainers` and `zwhy2025.open-dev-container` —
    connect over SSH, whose authority carries no Mac folder path.

Done when the README section is merged in `plume-works/vscode-expo-bridge`.
