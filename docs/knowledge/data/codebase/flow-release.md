---
type: codebase
description: How a version tag becomes three VSIX published to the Visual Studio Marketplace, Open VSX, and a GitHub Release, and what CI checks on every pull request.
source:
- .github/workflows
- packages/release
source_digest: sha256:ed5d4bbcd02fd9cbd3b3d34262163da70abbd4bd8192900907e13a71b6d6555b
verified:
  by: claude-code/opus-5.5
  at: 2026-10-28T19:20:43Z
stale_after: 2027-01-26
generated:
  by: claude-code/opus-5.5
  at: 2026-10-28T19:20:43Z
sources:
- id: code
  resource: .github/workflows/release.yml
---

# Flow: CI and release

## Trace

1. Every pull request and push to `main` runs `ci.yml`:
   `bun install --frozen-lockfile`, lint, typecheck, test, `bun run package`,
   and a check that all three VSIX exist — `.github/workflows/ci.yml:12`.
2. A pushed tag `v<major>.<minor>.<patch>` starts `release.yml` —
   `.github/workflows/release.yml:5`.
3. Its `build` job runs `release.ts` on the tag, which fails unless the tag is
   `v` plus the shared version and prints the channel —
   `packages/release/src/release.ts:14` ([Release
   tooling](packages/release.md)).
4. The same checks as CI run, then `bun run package` with `--pre-release` for an
   odd minor; the VSIX upload as one artifact.
5. The `publish` job, in the `release` environment, logs in to Azure with OIDC
   and runs `vsce publish` for host, workspace, then pack, so the pack never
   lists a missing extension — `.github/workflows/release.yml:76`.
6. It publishes the same three files to Open VSX with trusted publishing.
7. It creates the GitHub Release for the tag with the three VSIX attached.

## Failure modes

- A tag that does not match the manifests stops the run before packaging.
- `--skip-duplicate` makes a rerun after a partial publish safe on both
  registries.
- An access token set on the Open VSX step would override trusted publishing.

## Key references

Verified anchor points (line numbers as of 2026-10-28):

- `.github/workflows/ci.yml:12` — `jobs.build`
- `.github/workflows/release.yml:5` — tag trigger
- `.github/workflows/release.yml:76` — Visual Studio Marketplace publish
- `.github/workflows/marketplace-identity.yml:5` — manual identity lookup
- `packages/release/src/release.ts:14` — `checkTag`
