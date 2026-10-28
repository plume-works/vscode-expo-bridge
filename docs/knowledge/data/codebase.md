---
type: hub
description: Codebase maps derived from the code, each pinned to the tracked-source fingerprint it was read from.
stage: living
generated:
  by: claude-code/opus-5.5
  at: 2026-10-28T19:20:43Z
---

# 🧭 Codebase

*The map of the code as it actually is — written only by reading the code, never
from memory. The map mirrors the code's containment tree: one doc per component
(crate, package, module) at a canonical key matching its source path, children
linked from their parent's `## Contains` — so `iwe tree -k data/codebase`
renders the component tree. Every doc carries `source` (the code it describes),
`source_digest` (a fingerprint of that code's tracked contents), and `verified`
(the date); a digest that no longer matches the code means the doc is suspect —
refresh it. Division of truth: spec/ is what must be, architecture/ is why it's
shaped this way, this hub is what is.*

## Getting around

**Build, run, test** — from `.github/workflows/ci.yml`:
`bun install --frozen-lockfile`, `bun run lint` (Prettier), `bun run typecheck`,
`bun test`, and `bun run package`, which writes one VSIX per extension package.
Install the VSIX on the Mac and, for the workspace half, in the container
(`AGENTS.md`, Packaging the extensions for a manual test).

**Entry points** — the host extension's `activate`
(`packages/host/src/extension.ts`), the workspace extension's `activate`
(`packages/workspace/src/extension.ts`), the `eas-host` CLI
(`packages/workspace/bin/eas-host.ts`), `bun run bump`, and the tag-triggered
release workflow.

| Path                                                                 | Component                                                         |
| -------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `packages/protocol/`                                                 | [Protocol package](codebase/packages/protocol.md)                 |
| `packages/host/`                                                     | [Host extension](codebase/packages/host.md)                       |
| `packages/workspace/`                                                | [Workspace extension](codebase/packages/workspace.md)             |
| `packages/pack/`                                                     | [Extension pack](codebase/packages/pack.md)                       |
| `packages/release/`                                                  | [Release tooling](codebase/packages/release.md)                   |
| `.github/workflows/`                                                 | CI and release — [Flow: CI and release](codebase/flow-release.md) |
| `docs/protocol.md`                                                   | The protocol contract and security model (prose)                  |
| `docs/knowledge/`, `.iwe/`                                           | This knowledge graph                                              |
| `package.json`, `bun.lock`, `bunfig.toml`, `tsconfig.json`           | Bun workspace root and TypeScript config                          |
| `.prettierrc.json`, `.prettierignore`, `.vscodeignore`, `.gitignore` | Formatting and packaging config                                   |
| `README.md`, `AGENTS.md`, `CLAUDE.md`, `LICENSE`                     | User and agent documentation, MIT license                         |

## Components

[Protocol package](codebase/packages/protocol.md)

[Host extension](codebase/packages/host.md)

[Workspace extension](codebase/packages/workspace.md)

[Extension pack](codebase/packages/pack.md)

[Release tooling](codebase/packages/release.md)

## Flows

[Flow: a build request](codebase/flow-build.md)

[Flow: CI and release](codebase/flow-release.md)

## Interfaces

*External surfaces — HTTP APIs, CLI commands, storage formats, IPC contracts —
one doc each, keyed `api-<name>`.*

[Interface: eas-host CLI](codebase/api-eas-host.md)
