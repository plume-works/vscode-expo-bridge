---
type: task
created: 2026-10-23
stage: done
completed: 2026-10-23
priority: high
description: Make the Expo bridge self-explanatory to an agent — the template's Expo AGENTS.md rule names the action order and starting Metro before launch, and the sibling's eas-host help states the sequence and artifact location and install defaults to the latest build.
generated:
  by: claude-code/opus-5.5
  at: 2026-10-23T08:30:00Z
sources:
- resource: .agents/plugins/agentdev/skills/template-consume/references/consumption-guide.md
- resource: https://github.com/plume-works/vscode-expo-bridge/blob/main/packages/workspace/src/cli-args.ts
- resource: docs/knowledge/data/plans/20261015-vscode-expo-bridge.md
- resource: https://github.com/plume-works/vscode-expo-bridge/releases/tag/v0.2.1
---

# Make the Expo bridge self-explanatory to an agent

An agent in an Expo consumer can build, install, launch, and screenshot on the
Mac through `eas-host`, but nothing it reads tells it how. The template's iOS
build rule (step 4 of `## Optional Expo setup` in the template-consume
consumption guide) says only to use `eas-host` when `eas-host status` exits 0.
`eas-host`'s help is the one-line `USAGE` in the sibling's
`packages/workspace/src/cli-args.ts:21`, and `install` without a path is a usage
error (`:42`). An agent therefore reads the extension's bundled `eas-host.js` to
learn the sequence, lists `.tmp/` to find the artifact, and has to work out by
itself that `launch` needs Metro on port 8081. Each of those is a wasted turn,
and an agent that misses the Metro step sees a development build with no bundle.

The work spans both repositories:

- **This repository** — the consumption guide's iOS build rule names the order
  `status` → `build <profile>` → `install` → `launch` → `screenshot`, and says
  to start Metro in the container
  (`bunx expo start --dev-client --localhost --port 8081`) before `launch` of a
  development build. A change to that verbatim rule reaches existing consumers
  through update mode's Expo-profile reconciliation, which merges the customized
  root `AGENTS.md` by hand.
- **`plume-works/vscode-expo-bridge`** — `eas-host --help` states that sequence,
  that `build` returns the artifact's workspace-relative path under
  `.tmp/expo-bridge/`, and that `launch` of a development build loads from Metro
  on 8081; `install` with no path installs the newest build artifact under
  `.tmp/expo-bridge/`. `docs/protocol.md` `## eas-host` describes both, and
  `bun test` covers the help text and the default.

Done when the consumption guide's rule carries the order and the Metro step, and
the sibling change is merged and published in a patch release.
