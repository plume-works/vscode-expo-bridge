---
type: hub
description: Bug reports, investigations, and repro notes.
stage: living
generated:
  by: claude-code/opus-5.5
  at: 2026-10-28T19:40:00Z
---

# 🐛 Bugs

*One document per bug in `bugs/<slug>.md`, listed here whether open or closed.
Its title, body sections, and stages are defined under Bugs in `SCHEMA.md` and
enforced by `.iwe/schemas/bug.yaml`.*

[Bug: the Expo bridge's fix terminal launches the container's shell on the
Mac](bugs/expo-bridge-fix-terminal-remote-shell.md)

[Bug: the Expo bridge builds only the devcontainer window's root
folder](bugs/expo-bridge-builds-only-window-root.md)

[Bug: Expo bridge windows sharing a container break each other's
socket](bugs/expo-bridge-shared-socket-across-windows.md)

[Bug: the Expo bridge's bun fix upgrades a bun the check never
runs](bugs/expo-bridge-bun-fix-misses-path-bun.md)

[Bug: the Expo bridge's project ID check ignores dynamic app
config](bugs/expo-bridge-project-id-ignores-dynamic-config.md)

[Bug: the Expo bridge's build log tail drops
lines](bugs/expo-bridge-build-log-tail-drops-lines.md)

[Bug: the container sees the Expo bridge's build log only after the build
ends](bugs/expo-bridge-build-log-invisible-until-close.md)

[Bug: the Expo bridge's project ID diagnostic stays stale after a config
edit](bugs/expo-bridge-project-id-diagnostic-stale-after-config-edit.md)

[Bug: the Expo bridge's CocoaPods fix does not repair an unlinked
keg](bugs/expo-bridge-cocoapods-fix-misses-unlinked-keg.md)

[Bug: the Expo bridge's simulator profile quick fix omits the bun
pin](bugs/expo-bridge-simulator-profile-quick-fix-omits-bun.md)
