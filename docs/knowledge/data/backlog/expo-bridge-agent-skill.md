---
type: task
created: 2026-10-28
stage: planned
priority: high
description: Ship an agent skill that teaches the Expo bridge's eas-host sequence, generated from the same source as eas-host --help, delivered through a plugin marketplace, installed by the workspace extension, or both.
generated:
  by: claude-code/opus-5.5
  at: 2026-10-28T17:05:00Z
sources:
- resource: packages/workspace/src/cli-args.ts
- resource: README.md
- resource: docs/knowledge/data/backlog/expo-bridge-agent-guidance.md
- resource: https://github.com/plume-works/agent-devcontainer/blob/main/.agents/plugins/agentdev/skills/template-consume/references/consumption-guide.md
---

# Ship an agent skill for the Expo bridge

An agent learns the bridge today from `eas-host --help` (`HELP` in
`packages/workspace/src/cli-args.ts`) or from an `AGENTS.md` rule its project
wrote by hand; the agentdev template's Expo profile writes one, a project
without that template has none. A skill an agent loads on its own carries the
sequence to every project that installs the pack.

The skill states:

- run `eas-host status` first, then `build <profile>`, `install`, start Metro in
  the container (`bunx expo start --dev-client --localhost --port 8081`),
  `launch`, and `screenshot`;
- artifacts and screenshots land under `.tmp/expo-bridge/`;
- run it inside the Expo app's workspace folder;
- when `status` exits non-zero, build the same profile on EAS cloud.

Its text is generated from the same source as `eas-host --help`, so the two
cannot drift.

Delivery stays open among three options:

- **A. A plugin marketplace in this repository** — `skills/expo-bridge/SKILL.md`
  and `.claude-plugin/marketplace.json`, installed with `/plugin install`.
  Claude Code only, and a manual step on each machine.
- **B. The workspace extension installs it** — on activation it writes the skill
  into the container's per-user agent skill directories, as it writes `eas-host`
  into `~/.local/bin`, never into the workspace. It replaces only a copy
  carrying its own version marker and leaves a user's same-named skill alone;
  removal on uninstall is decided or recorded as a limit; the new write outside
  the workspace is documented in `docs/protocol.md` and `README.md`.
- **C. Both** — B for the devcontainer, A for agents outside one.

Done when the chosen option ships, its acceptance names that option, and for B
the skill directories are verified against each agent's current documentation.
