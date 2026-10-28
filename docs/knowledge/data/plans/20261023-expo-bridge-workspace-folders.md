---
type: plan
created: 2026-10-23
release:
- features/vscode-expo-bridge
- bugs/expo-bridge-builds-only-window-root
- bugs/expo-bridge-shared-socket-across-windows
description: Make every `eas-host` action reach the VS Code window it runs in and act on the workspace folder that contains its working directory — one socket per window found through a registry, the folder mapped to its Mac path through the devcontainer's Docker bind mounts, trust still keyed to the window's host path, and protocol version 2.
generated:
  by: claude-code/opus-5.5
  at: 2026-10-24T01:42:10Z
sources:
- resource: docs/knowledge/data/bugs/expo-bridge-builds-only-window-root.md
- resource: docs/knowledge/data/bugs/expo-bridge-shared-socket-across-windows.md
- resource: docs/knowledge/data/plans/20261015-vscode-expo-bridge.md
- resource: https://github.com/plume-works/vscode-expo-bridge
- resource: https://code.visualstudio.com/docs/devcontainers/containers
stage: done
completed: 2026-10-24
---

# Expo bridge acts on the agent's window and workspace folder

## Context

The [VS Code Expo bridge](../features/vscode-expo-bridge.md) assumes one window
per container and one project per window. Two defects follow:

- [The bridge builds only the window's root
  folder](../bugs/expo-bridge-builds-only-window-root.md): the host resolves
  every action against the window's host path, so an Expo app in another
  workspace folder cannot be checked or built, and `status` does not say what it
  inspected.
- [Windows sharing a container break each other's
  socket](../bugs/expo-bridge-shared-socket-across-windows.md): every window
  listens on one fixed socket path and deletes it on activation and shutdown.

Both are fixed together because both answer the same question — which window and
which folder a request belongs to — and the fix changes the protocol once.

The container side also takes `workspaceFolders[0]` as its root
(`packages/workspace/src/extension.ts:118`) for the build log it tails and the
newest artifact `install` picks. The two sides meet in `.tmp/expo-bridge/` only
when that folder is where the host path is mounted, so the write directory moves
with the project folder too.

Settled facts this plan builds on:

- **Dev Containers labels every container it creates** with
  `devcontainer.local_folder` (the host path) and `devcontainer.config_file`
  (the Mac path of the `devcontainer.json` it used). On a Mac with Docker
  Desktop, `docker ps --filter label=devcontainer.local_folder=<host path>`
  finds the window's container, and its `config_file` label names
  `<host path>/.devcontainer/devcontainer.json`.
- **The bind mounts give the mapping.** That container's bind mounts list the
  host path at `/workspaces/<name>`, and a project may add more: the same host
  path at its own Mac path, a `.git` directory, unrelated directories such as
  `~/.docker/mcp`, and sockets under a Docker Desktop VM path. Compose files,
  `runArgs`, and `mounts` can add others, so `devcontainer.json` alone does not
  describe them.
- **The window's remote authority** is `dev-container+<hex>`. In Dev Containers
  0.469.0 its payload is either the bare host path or a JSON object with
  `hostPath`, `localDocker`, `settings`, and `configFile` (a serialized URI);
  the object form is written only when `settings` or `configFile` is set, and
  `settings.host` names a non-default Docker daemon.
- **`remote-containers.openDevContainerFile` returns nothing**: in Dev
  Containers 0.469.0 it opens the file in an editor from the extension's private
  in-memory state.
- **`dev.containers.dockerPath`** is an application-scoped setting, default
  `docker`, in Dev Containers 0.469.0.
- **The host can run `docker` as the user.** Dev Containers reached the same
  daemon as the same Mac user to open the window.

## Approach

**One socket per window, found through a registry.** Each workspace extension
activation picks a random id and serves `/tmp/vscode-expo-bridge/<id>.sock`,
next to `<id>.json` holding its process id, its activation time, and the
container paths of its workspace folders, rewritten when the folders change. On
disposal it removes only its own two files. On activation it removes entries
whose process no longer exists. `eas-host` reads the registry, keeps the entries
with a folder containing its working directory, and connects to the one with the
longest matching folder, the most recently activated on a tie. With no such
entry it exits 3, naming its working directory, so an agent falls back to EAS
cloud.

**The project is a workspace folder.** `eas-host` sends its working directory.
The workspace extension picks its workspace folder that contains it — the
longest match — and forwards the request with that folder's container path as
`folder`. It tails the build log and finds the newest artifact under that
folder's `.tmp/expo-bridge/`.

**The host maps the folder through Docker.** For each request, the host:

1. resolves the trusted host path from its own window's authority;
2. requires `folder` to be one of its own window's workspace folders;
3. finds the container with `docker ps` filtered on
   `devcontainer.local_folder=<host path>`, and also on
   `devcontainer.config_file=<path>` when the authority names `configFile`,
   against the daemon in the authority's `settings.host` when present, and
   requires exactly one running container;
4. reads that container's bind mounts with `docker inspect`, takes the one whose
   destination is the longest path-component prefix of `folder`, and appends the
   rest of `folder` to its source;
5. accepts the result only when it is the host path or lies under it, with no
   symlink component below the host path.

Any failure — no `docker`, no daemon, zero or several containers, no bind mount,
a result outside the host path — makes the request `unavailable`; the host never
falls back to the host path. Every action then uses the folder's Mac path where
it used the host path: `status` reads `eas.json` and `app.json` there, `build`
runs there, and every write lands in its `.tmp/expo-bridge/`. `status` reports
that Mac path.

**Trust stays on the host path.** Trust is about what runs on the Mac, and the
host path is the one location the container cannot redirect. The trust prompt
and the cooldown stay keyed to it; the build confirmation also names the
folder's Mac path. A container that reaches the Mac's Docker daemon can label
another container with the same host path, which makes requests `unavailable`,
and can mount other Mac directories into it, which step 5 rejects; it can pick
no folder outside the host path.

**The host runs `docker`** through the existing argument-array runner, found as
the `dev.containers.dockerPath` setting's user-level value when set, otherwise
in the login environment's `PATH` plus the Homebrew prefixes and
`~/.docker/bin`. The host reads only the user-level value, because the container
can write workspace settings. `docker ps` and `docker inspect` are read-only.

**Protocol version 2.** Every request carries `folder`, and the host rejects a
request without it as `bad-request`. A mismatched pairing reports unavailable
through `eas-host status`'s existing version check, rather than an older host
silently acting on the host path.

Rejected: an environment variable naming the socket, set in each window's
terminals through `EnvironmentVariableCollection` — it goes stale after a window
reload and never reaches an agent started outside a VS Code terminal, while the
registry answers both. Rejected: reading `workspaceFolder` from
`devcontainer.json` — a repository may have several configurations, the value
uses variables, and compose files, `runArgs`, and `mounts` change the mounts it
describes. Rejected: `remote-containers.openDevContainerFile`, which returns
nothing. Rejected: walking up from the working directory to the nearest
`eas.json` — the workspace folder is already the unit VS Code and the agent work
in. Rejected: staying on protocol version 1 with an optional `folder` — an older
host would ignore it and act on the host path, which is the defect.

Assumptions:

- The registry directory is created with mode `0700`; an entry whose owner is
  not the current user is ignored.
- The container is looked up on every request, not cached: a `docker ps` and a
  `docker inspect` cost far less than any action that follows.
- A Dev Containers Docker daemon given as a Unix socket path in `settings.host`
  is passed to `docker -H` as `unix://<path>`; any other value is passed as is.

## Implementation Steps

### Task 1: Protocol version 2

**Files:** Modify: `packages/protocol/src/index.ts`, its test, in
`plume-works/vscode-expo-bridge`

- [x] `PROTOCOL_VERSION` is 2. Every request type carries `folder: string`, the
  container path of a workspace folder. `StatusResult` carries `folderHostPath`
  (the Mac path inspected, empty when unmapped) and a `workspaceMapped` check.
  - **Evidence:** `plume-works/vscode-expo-bridge` commit `bd7af44` (PR #20);
    `bun test packages/protocol` passes.
- [x] `SOCKET_PATH` is replaced by `SOCKET_DIR`, `/tmp/vscode-expo-bridge`, and
  the shape of a registry entry is exported for both container-side packages.
  - **Evidence:** `plume-works/vscode-expo-bridge` commit `bd7af44` (PR #20)
    exports `SOCKET_DIR`, `RegistryEntry`, and `parseRegistryEntry`;
    `packages/protocol/test/index.test.ts` passes.

### Task 2: Workspace extension — one socket per window

**Files:** Modify: `packages/workspace/src/extension.ts`; Create:
`packages/workspace/src/registry.ts`, its test

- [x] On activation the extension serves `<SOCKET_DIR>/<id>.sock` and writes
  `<id>.json` with its process id, activation time, and workspace folders, and
  rewrites the entry on `onDidChangeWorkspaceFolders`.
  - **Evidence:** `plume-works/vscode-expo-bridge` commit `da61ade` (PR #20);
    `packages/workspace/test/registry.test.ts` passes (write, rewrite, read
    back). The activation wiring itself runs only in VS Code, in Task 11.
- [x] Disposal removes only its own socket and entry; activation removes entries
  whose process is gone, and never touches another live window's files.
  - **Evidence:** `plume-works/vscode-expo-bridge` commit `da61ade` (PR #20);
    `packages/workspace/test/registry.test.ts` passes its `removeOwn` and
    `pruneStale` cases.

### Task 3: `eas-host` connects to its own window

**Files:** Modify: `packages/workspace/bin/eas-host.ts`,
`packages/workspace/src/cli-args.ts`, their tests

- [x] `eas-host` picks the live registry entry with the longest workspace folder
  containing its real working directory, the most recently activated on a tie,
  and sends its working directory with the request.
  - **Evidence:** `plume-works/vscode-expo-bridge` commit `87493e2` (PR #20);
    `packages/workspace/test/registry.test.ts` (`selectEntry`) and
    `packages/workspace/test/eas-host.test.ts` (the request carries `cwd`) pass.
- [x] With no such entry it prints that no VS Code window has a workspace folder
  containing the directory and exits 3. `eas-host --help` says to run it inside
  the Expo app's workspace folder.
  - **Evidence:** `plume-works/vscode-expo-bridge` commit `87493e2` (PR #20);
    `packages/workspace/test/eas-host.test.ts` (a run outside every folder) and
    `packages/workspace/test/cli-args.test.ts` (help) pass.

### Task 4: Workspace extension — the request's folder

**Files:** Modify: `packages/workspace/src/extension.ts`,
`packages/workspace/src/artifacts.ts`, their tests

- [x] The extension resolves the working directory to its longest containing
  workspace folder and forwards the request with that `folder`; a directory
  outside every folder answers `unavailable`.
  - **Evidence:** `plume-works/vscode-expo-bridge` commit `38c3932` (PR #20);
    `packages/workspace/test/artifacts.test.ts` (`resolveRequest`) passes.
- [x] The build log it tails and the newest artifact `install` picks come from
  that folder's `.tmp/expo-bridge/`.
  - **Evidence:** `plume-works/vscode-expo-bridge` commit `38c3932` (PR #20);
    `packages/workspace/test/artifacts.test.ts` passes its second-folder
    artifact case. The log tail runs only in VS Code, in Task 11.

### Task 5: Host — the authority's config file and Docker daemon

**Files:** Modify: `packages/host/src/hostpath.ts`, its test

- [x] `decodeHostPath` also returns `configFile` as a Mac path and the Docker
  host from `settings.host`, when the payload carries them, and still accepts a
  bare host path.
  - **Evidence:** `plume-works/vscode-expo-bridge` commit `ba42312` (PR #20);
    `packages/host/test/hostpath.test.ts` passes.

### Task 6: Host — find the container and its bind mounts

**Files:** Create: `packages/host/src/container.ts`, its test; Modify:
`packages/host/src/env.ts`

Docker Desktop reports a bind source under its VM's `/host_mnt`, so the bind
mounts are read with that prefix removed.

- [x] The `docker` binary comes from the user-level `dev.containers.dockerPath`
  value, else from the login `PATH`, the Homebrew prefixes, and `~/.docker/bin`.
  - **Evidence:** `plume-works/vscode-expo-bridge` commit `80fcdae` (PR #20)
    (`lookupDocker` in `packages/host/src/env.ts`, which reads only
    `globalValue` of the setting's `inspect()` result);
    `packages/host/test/env.test.ts` passes, including the ignored
    workspace-level value.
- [x] The container lookup filters on `devcontainer.local_folder`, and on
  `devcontainer.config_file` when known, against the authority's daemon; zero or
  several running containers is `unavailable`. Its bind mounts are read with
  `docker inspect`, run as argument arrays.
  - **Evidence:** `plume-works/vscode-expo-bridge` commit `80fcdae` (PR #20);
    `packages/host/test/container.test.ts` passes. `ContainerError` becomes
    `unavailable` where Task 7 resolves the folder. The `/host_mnt` prefix
    removal is commit `af804c5` (PR #20).

### Task 7: Host — map a workspace folder to its Mac path

**Files:** Create: `packages/host/src/folder.ts`, its test; Modify:
`packages/host/src/paths.ts`

- [x] A pure function maps a container folder to a Mac path through the longest
  path-component prefix among the bind mounts' destinations, with tests for the
  repeated host-path mounts, a `.git` mount, an unrelated mount, a non-bind
  mount, and a folder outside every mount.
  - **Evidence:** `plume-works/vscode-expo-bridge` commit `85742ec` (PR #20)
    (`mapFolder` in `packages/host/src/folder.ts`);
    `packages/host/test/folder.test.ts` passes each named case.
- [x] The host accepts the result only when `folder` is one of its window's
  workspace folders and the result is the host path or under it with no symlink
  component; anything else is `unavailable`.
  - **Evidence:** `plume-works/vscode-expo-bridge` commit `85742ec` (PR #20)
    (`resolveFolder`, with `rejectSymlinksBelow` in
    `packages/host/src/paths.ts`); `packages/host/test/folder.test.ts` and
    `packages/host/test/paths.test.ts` pass. Task 8's `dispatch` answers a
    rejected mapping as `unavailable`.

### Task 8: Host — every action runs at the folder's Mac path

**Files:** Modify: `packages/host/src/extension.ts`,
`packages/host/src/dispatch.ts`, `packages/host/src/status.ts`,
`packages/host/src/build.ts`, `packages/host/src/install.ts`,
`packages/host/src/eascli.ts`, `packages/host/src/trust.ts`, their tests

- [x] `dispatch` rejects a request without `folder` as `bad-request`, and maps
  it before any action; `status`, `build`, `install`, `launch`, and `screenshot`
  read and write at the folder's Mac path.
  - **Evidence:** `plume-works/vscode-expo-bridge` commit `3a7ce79` (PR #20);
    `packages/host/test/dispatch.test.ts`, `build.test.ts`, `install.test.ts`,
    and `status.test.ts` pass; `bun test` (250 tests), `bun run typecheck`,
    `bun run lint`, and `bun run package` pass at that commit.
- [x] `status` reports `folderHostPath` and `workspaceMapped`, and is
  unavailable when the folder does not map. Trust and the cooldown stay keyed to
  the host path, and the build confirmation names the folder's Mac path.
  - **Evidence:** `plume-works/vscode-expo-bridge` commit `3a7ce79` (PR #20);
    `packages/host/test/status.test.ts`, `dispatch.test.ts`, and `trust.test.ts`
    (a build in a folder under the host path) pass.

### Task 9: Document the change in the sibling repository

**Files:** Modify: `docs/protocol.md`, `README.md`, in
`plume-works/vscode-expo-bridge`

- [x] `docs/protocol.md` describes the per-window socket and registry, the
  `folder` field and its mapping, protocol version 2, the `status` fields, and
  replaces "never from a path the request supplies" with the rule that a request
  may choose only a workspace folder of its window, mapped through Docker under
  the host path. The README names the multi-root and multi-window support.
  - **Evidence:** `plume-works/vscode-expo-bridge` commit `c5266bf` (PR #20);
    `bun run lint` passes.

### Task 10: Sibling repository CI passes

**Files:** none

- [x] The sibling repository's CI passes on the commit that completes Tasks 1–9.
  - **Evidence:** CI run 40040548455 passes on `e7bc5d9`, the head of
    `plume-works/vscode-expo-bridge#20`.

### Task 11: Mac round trip from the packaged VSIX files

**Files:** none — on a Mac, with the packaged extensions sideloaded, this
repository opened in a Dev Containers window and an Expo app under it

- [x] With the app added as a second workspace folder, `eas-host status` run in
  the app reports the app's Mac path, its `eas.json` `cli.version`, and its
  project id; `build`, `install`, `launch`, and `screenshot` complete there. Run
  at the repository root, `status` reports the root.
  - **Evidence:** On 2026-10-24, macOS with Docker Desktop, host and workspace
    extensions packaged from `plume-works/vscode-expo-bridge` commit `af804c5`
    (PR #20), `agent-devcontainer` opened as a multi-root workspace with the app
    second. `status` in the app reported the app's Mac path, `eas-cli@25.3.0`,
    and the project id; `build development` exited 0 with its artifact and log
    in the app's `.tmp/expo-bridge/`; `install`, `launch`, and `screenshot`
    succeeded, the screenshot showing the app's bundle from Metro. `status` at
    the root reported the root.
- [x] A second window opened on the app in the same container serves its own
  socket; closing the first window leaves `eas-host status` in the second
  working.
  - **Evidence:** On 2026-10-24, in the same setup, a second window opened with
    `code -n` on the app registered its own socket and entry beside the first
    window's. After the first window closed, only the second window's files
    remained, and `eas-host status` in the app exited 0 with the app's Mac path.
- [x] A host extension still on protocol version 1 makes `eas-host status` exit
  3 and name both versions.
  - **Evidence:** On 2026-10-24, with the published host extension 0.2.2 on the
    Mac and workspace extension from commit `af804c5` (PR #20) in the container,
    `eas-host status` in the app exited 3 and printed
    `expo bridge protocol version mismatch: host 1, eas-host 2`.

### Task 12: Record the change in this repository's project memory

**Files:** Modify: `docs/knowledge/data/features/vscode-expo-bridge.md`,
`docs/knowledge/data/architecture/vscode-expo-bridge.md`,
`docs/knowledge/data/bugs/expo-bridge-builds-only-window-root.md`,
`docs/knowledge/data/bugs/expo-bridge-shared-socket-across-windows.md`

- [x] The feature's `## Behaviour` and `## Edge cases` describe the per-window
  socket and the project as the workspace folder containing the working
  directory; the architecture document describes the registry, the Docker
  mapping, and the trust rule in its security model, with this plan's rejected
  alternatives; each bug's `## Fix` describes the fix.
  - **Evidence:** commit `e9a193e` updates the four documents; `iwe normalize`
    and `iwe schema validate` pass.

## Spec changes

None in `data/spec/` — this repository's spec covers only the template wiring,
which this plan leaves unchanged. The protocol contract lives in
`plume-works/vscode-expo-bridge` `docs/protocol.md` (Task 9). Its intended
post-change behavior, which Task 11 verifies:

``` markdown
## ADDED Requirements

### Requirement: eas-host reaches the window it runs in

Each workspace extension SHALL serve its own socket and SHALL remove only the
socket and registry entry it created. `eas-host` SHALL connect to the window
whose workspace folder contains its working directory, the longest match first,
and SHALL exit 3 when no window has such a folder.

#### Scenario: two windows on one container

- **WHEN** two windows on the same container are open and the first one closes
- **THEN** `eas-host` in the second window still reaches its own window

#### Scenario: a directory outside every workspace folder

- **WHEN** `eas-host status` runs in a directory no window's workspace folder
  contains
- **THEN** it exits 3 and names the directory

### Requirement: a request acts on its workspace folder

Every request SHALL carry `folder`, the container path of the workspace folder
that contains `eas-host`'s working directory. The host SHALL map it to a Mac
path through the bind mounts of the one running container labeled with the
window's host path, and SHALL act on that path, writing only under its
`.tmp/expo-bridge/`. The host SHALL report `unavailable`, and never fall back to
the host path, when the folder is not one of its window's workspace folders,
when no single container matches, or when the mapped path is not the host path
or under it, or has a symlink component below it.

#### Scenario: an app in a second workspace folder

- **WHEN** `eas-host status` runs in an Expo app added as a second workspace
  folder
- **THEN** it reports the app's Mac path in `folderHostPath`, and its checks
  read the app's `eas.json` and `app.json`

#### Scenario: a folder that maps outside the host path

- **WHEN** a request's folder maps through a bind mount whose source is outside
  the host path
- **THEN** the host answers `unavailable`

#### Scenario: several containers carry the host path's label

- **WHEN** more than one running container is labeled with the window's host
  path and the authority names no config file
- **THEN** the host answers `unavailable`

## MODIFIED Requirements

### Requirement: trust is keyed to the window's host path

The host SHALL resolve the trusted host path from its own window's remote
authority, never from a request. A request MAY choose only a workspace folder of
its window that maps under that host path. Trust and the build cooldown SHALL be
keyed to the host path, and the build confirmation SHALL name the folder's Mac
path.

#### Scenario: an injected workspace folder

- **WHEN** a container-side extension adds a workspace folder and a request
  names it
- **THEN** trust is still asked and recorded for the authority's host path
- **AND** the folder is acted on only when it maps under that host path

### Requirement: protocol version

The protocol version SHALL be 2, and the host SHALL reject a request without
`folder` as `bad-request`. `eas-host status` SHALL exit 3 against a host on
another protocol version.

#### Scenario: a version 1 host

- **WHEN** `eas-host status` reaches a host on protocol version 1
- **THEN** it exits 3 and names both versions
```

## Depends on

- [Build iOS on the Mac host through a VS Code
  bridge](20261015-vscode-expo-bridge.md) — this work changes that plan's
  protocol and ships through the release sequence it defines.

## Verification

- In `plume-works/vscode-expo-bridge`, `bun test` passes, and the sibling CI
  passes (Task 10).
- Task 11's Mac run behaves as described.
- `iwe normalize` and `iwe schema validate` pass.

## Out of scope

- An Expo app in a subdirectory that is not itself a workspace folder; it is
  added as a workspace folder.
- Devcontainers that Dev Containers did not create, such as one attached with
  **Attach to Running Container**, and Codespaces; the host extension already
  works only in a `dev-container+` window.
- Docker runtimes other than Docker Desktop beyond what Task 11 covers; each
  needs its own `status` run before it is called supported.
- [Reusing a matching build by
  fingerprint](20261023-expo-bridge-fingerprint-reuse.md), which follows this
  plan.
- Changing the template's Expo agent rule in the consumption guide.

## Key references

Verified anchor points (line numbers as of 2026-10-23):

In `plume-works/vscode-expo-bridge` at `63fc991`:

- `packages/protocol/src/index.ts:6` — `PROTOCOL_VERSION`
- `packages/protocol/src/index.ts:9` — `SOCKET_PATH`
- `packages/protocol/src/index.ts:12` — `WRITE_DIR_REL`
- `packages/protocol/src/index.ts:44` — `Request`
- `packages/protocol/src/index.ts:57` — `StatusResult`
- `packages/workspace/src/extension.ts:60` — `newestBuildLog`
- `packages/workspace/src/extension.ts:72` — `handleRequest`
- `packages/workspace/src/extension.ts:118` — `workspaceRoot` from
  `workspaceFolders?.[0]`
- `packages/workspace/src/extension.ts:121` — `rmSync(SOCKET_PATH)` before
  listening
- `packages/workspace/src/extension.ts:142` — `server.listen(SOCKET_PATH)`
- `packages/workspace/src/extension.ts:148` — `rmSync(SOCKET_PATH)` on dispose
- `packages/workspace/src/artifacts.ts:14` — `newestArtifact`
- `packages/workspace/src/artifacts.ts:26` — `resolveRequest`
- `packages/workspace/src/cli-args.ts:23` — `HELP`
- `packages/workspace/src/cli-args.ts:55` — `parseArgs`
- `packages/workspace/bin/eas-host.ts:39` — `createConnection(SOCKET_PATH)`
- `packages/workspace/bin/eas-host.ts:81` — the protocol version equality check
- `packages/workspace/package.json:23` — `workspaceContains:eas.json`
- `packages/host/src/hostpath.ts:11` — `decodeHostPath`
- `packages/host/src/extension.ts:31` — the build confirmation prompt
- `packages/host/src/extension.ts:103` — `resolveHostPath`
- `packages/host/src/extension.ts:110` — `buildDispatchDeps`
- `packages/host/src/dispatch.ts:32` — `dispatch`
- `packages/host/src/dispatch.ts:52` — the null host-path gate
- `packages/host/src/status.ts:46` — `status`
- `packages/host/src/status.ts:134` — `readProjectId`
- `packages/host/src/build.ts:44` — `build`
- `packages/host/src/install.ts:67` — `install`
- `packages/host/src/install.ts:129` — `screenshot`
- `packages/host/src/eascli.ts:31` — `easCliSpec`
- `packages/host/src/paths.ts:29` — `resolveWithin`
- `packages/host/src/env.ts:49` — `lookupTool`
- `packages/host/src/trust.ts:81` — `TrustStore.ensureTrusted`
- `packages/host/src/trust.ts:98` — `TrustStore.confirmBuild`
- `docs/protocol.md:38` — the host resolving the workspace from its authority
- `docs/protocol.md:56` — `## Transport`
- `docs/protocol.md:87` — `### status`
- `docs/protocol.md:183` — `## Errors`
- `docs/protocol.md:199` — `## eas-host`
