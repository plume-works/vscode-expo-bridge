---
type: codebase
description: Bun scripts that keep the pack and both extensions on one shared version and check a release tag against it, deriving the Marketplace channel.
source: packages/release
source_digest: sha256:8842a48d59b24643a57fa18d741a2b444e27caf8b0863d40b43b33d81aed4e3e
verified:
  by: claude-code/opus-5.5
  at: 2026-10-28T19:20:43Z
stale_after: 2027-01-26
generated:
  by: claude-code/opus-5.5
  at: 2026-10-28T19:20:43Z
sources:
- id: code
  resource: packages/release
---

# Release tooling

`@plume-works/expo-bridge-release`, a private package of two scripts: `bump.ts`
behind `bun run bump`, and `release.ts`, which the release workflow runs on the
pushed tag.

## Public surface

- `bun run bump [<version>]` — sets the pack, host, and workspace `package.json`
  to the next patch, or to the given `major.minor.patch`.
- `bun packages/release/src/release.ts <tag>` — prints `release` or
  `pre-release`, or fails when the tag is not `v<shared version>`.

## How it works

`bump` reads the three manifests, refuses when their versions differ, and
rewrites each with the new version. `checkTag` compares the tag with that shared
version; `channelOf` maps an odd minor to `pre-release` and an even one to
`release`.

## Invariants & gotchas

- The three extensions always carry one version; any divergence makes both
  scripts throw.

## Key references

Verified anchor points (line numbers as of 2026-10-28):

- `packages/release/src/bump.ts:5` — `EXTENSIONS`
- `packages/release/src/bump.ts:30` — `bump`
- `packages/release/src/release.ts:7` — `channelOf`
- `packages/release/src/release.ts:14` — `checkTag`
