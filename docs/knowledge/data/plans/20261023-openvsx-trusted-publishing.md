---
type: plan
created: 2026-10-23
release: internal
description: Move the VS Code Expo bridge's Open VSX publishing from the OVSX_PAT access token to Open VSX trusted publishing — namespace ownership granted, a trusted publisher per extension for release.yml and the release environment, a publish job that passes no token, and the token revoked.
generated:
  by: claude-code/opus-5.5
  at: 2026-10-23T19:00:44Z
sources:
- resource: docs/knowledge/data/plans/20261015-vscode-expo-bridge.md
- resource: https://github.com/eclipse/openvsx/wiki/Trusted-Publishing
- resource: https://github.com/eclipse/openvsx/wiki/Namespace-Access
- resource: https://github.com/EclipseFdn/open-vsx.org/issues/14608
- resource: https://github.com/plume-works/vscode-expo-bridge
stage: done
completed: 2026-10-23
---

# Publish the Expo bridge to Open VSX through trusted publishing

## Context

The [bridge plan](20261015-vscode-expo-bridge.md) publishes the three
`plume-works` extensions to Open VSX from the release workflow of
`plume-works/vscode-expo-bridge` with an access token, the `release` environment
secret `OVSX_PAT`. It is the one long-lived publishing secret left: the Visual
Studio Marketplace already signs in through GitHub OIDC. Open VSX trusted
publishing exchanges the same OIDC token for a short-lived publishing token, but
registering a trusted publisher requires the namespace to be owned, and Eclipse
grants ownership by a manual review of a public claim
([EclipseFdn/open-vsx.org#14608](https://github.com/EclipseFdn/open-vsx.org/issues/14608)).
This work is kept apart so that the review does not hold up the bridge's
releases.

## Approach

Each of the three extensions gets a GitHub Actions trusted publisher for owner
`plume-works`, repository `vscode-expo-bridge`, workflow `release.yml`, and
environment `release`. A registration is not tied to a ref, so the `release`
environment's tag-only rule and required reviewer stay the restriction. The
publish job's Open VSX step then runs `ovsx publish --trusted-publishing` and
passes no token: an access token, given as `-p` or the `OVSX_PAT` variable,
takes precedence over trusted publishing. The token is revoked only after a
release workflow run has published through trusted publishing. Rejected: keeping
`OVSX_PAT` — a long-lived secret that can publish to the namespace from
anywhere.

Assumptions:

- open-vsx.org offers GitHub Actions as a trusted publisher provider; Task 2
  shows it. If it does not, the plan goes back to revise.

## Implementation Steps

### Task 1: Namespace ownership

**Files:** none — Eclipse's review of the claim

- [x] Open VSX reports the namespace `plume-works` as verified
  (`https://open-vsx.org/api/plume-works` returns `"verified": true`).
  - **Evidence:** `https://open-vsx.org/api/plume-works` returned
    `"verified": true` on 2026-10-23; EclipseFdn/open-vsx.org#14608 is closed.

### Task 2: Register the trusted publishers

**Files:** none — done by the user on open-vsx.org

- [x] `plume-works.vscode-expo-bridge`, `plume-works.vscode-expo-bridge-host`,
  and `plume-works.vscode-expo-bridge-workspace` each have a GitHub Actions
  trusted publisher for `plume-works/vscode-expo-bridge`, workflow
  `release.yml`, environment `release`.
  - **Evidence:** the user registered all three on open-vsx.org on 2026-10-23;
    the Task 4 release run is what confirms them.

### Task 3: Publish to Open VSX without a token

**Files:** Modify: `.github/workflows/release.yml` in
`plume-works/vscode-expo-bridge`

- [x] The publish job's Open VSX step runs
  `bunx ovsx publish "$vsix" --skip-duplicate --trusted-publishing` for each
  VSIX and sets no `OVSX_PAT`; the patch version is bumped, and CI passes on its
  pull request and on `main`.
  - **Evidence:** plume-works/vscode-expo-bridge#19, squash-merged as `63fc991`
    (version 0.2.2); CI passed on the pull request and on `main` (run
    40001288795).

### Task 4: A release publishes through trusted publishing

**Files:** none — a release workflow run from a `vX.Y.Z` tag

- [x] A release workflow run publishes all three extensions to Open VSX through
  trusted publishing, and Open VSX lists that version for each.
  - **Evidence:** release run 40001397798 from `v0.2.2` logs a trusted
    publishing token issued for each extension; Open VSX lists 0.2.2 for all
    three.

### Task 5: Retire the access token

**Files:** none — done by the user, after Task 4

- [x] The token behind `OVSX_PAT` is revoked on open-vsx.org, and `OVSX_PAT` is
  removed from the environment `release`.
  - **Evidence:** the user revoked the token on 2026-10-23;
    `gh api repos/plume-works/vscode-expo-bridge/environments/release/secrets`
    lists only `AZURE_CLIENT_ID` and `AZURE_TENANT_ID`.

## Spec changes

None — no behavioral change.

## Depends on

- [Build iOS on the Mac host through a VS Code
  bridge](20261015-vscode-expo-bridge.md) — its release workflow and its token
  publishing to Open VSX are what this plan changes.

## Verification

- `https://open-vsx.org/api/plume-works` returns `"verified": true`.
- The Task 4 run's Open VSX step logs a trusted-publishing token exchange and
  each extension's version on Open VSX matches the run's tag.
- `gh api repos/plume-works/vscode-expo-bridge/environments/release/secrets`
  lists no `OVSX_PAT`.
- `iwe normalize` and `iwe schema validate` pass.

## Out of scope

- Visual Studio Marketplace authentication, which already uses Microsoft Entra
  ID through GitHub OIDC.
- Namespaces other than `plume-works`.

## Key references

Verified anchor points (line numbers as of 2026-10-23):

- `plume-works/vscode-expo-bridge` `.github/workflows/release.yml:81` — the
  `Publish to Open VSX` step; `:83` — its `OVSX_PAT` variable; `:86` — the
  `ovsx publish` call
- `plume-works/vscode-expo-bridge` `.github/workflows/release.yml:48` — the
  publish job's `environment: release`
