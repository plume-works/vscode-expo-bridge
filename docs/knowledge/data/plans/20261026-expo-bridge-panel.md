---
type: plan
created: 2026-10-26
release:
- features/vscode-expo-bridge
- bugs/expo-bridge-project-id-ignores-dynamic-config
- bugs/expo-bridge-build-log-invisible-until-close
- bugs/expo-bridge-build-log-tail-drops-lines
description: Give the Expo bridge's workspace extension an activity-bar panel, an always-on status bar item, and Problems-panel diagnostics with quick fixes for every status check and container config check, with the project ID resolved in the container and the Mac sending each build log chunk to the container, at protocol version 2 with no new request or response field.
generated:
  by: claude-code/opus-5.5
  at: 2026-10-28T06:09:33Z
sources:
- resource: docs/knowledge/data/architecture/vscode-expo-bridge.md
- resource: docs/knowledge/data/features/vscode-expo-bridge.md
- resource: docs/knowledge/data/bugs/expo-bridge-project-id-ignores-dynamic-config.md
- resource: https://github.com/plume-works/vscode-expo-bridge
- resource: https://github.com/plume-works/vscode-expo-bridge/blob/main/docs/protocol.md
- resource: https://code.visualstudio.com/api/references/contribution-points
- resource: https://code.visualstudio.com/api/references/vscode-api
- resource: https://docs.expo.dev/workflow/configuration/
- resource: https://github.com/microsoft/vscode/blob/main/src/vs/workbench/api/browser/viewsExtensionPoint.ts
stage: done
completed: 2026-10-28
---

# Expo Bridge panel, status bar, and Problems in the workspace extension

## Context

The [VS Code Expo bridge](../features/vscode-expo-bridge.md) reports its state
in places that are hard to find. `eas-host status` prints 14 checks that only
the agent reads. The host extension shows a fix status bar item and toasts. Five
commands sit in the Command Palette. A person in the window has no one place to
see whether the bridge works, why it does not, or what to do next. Config
mistakes in `app.json` or `eas.json` show up nowhere near the file.

[Bug: the Expo bridge's project ID check ignores dynamic app
config](../bugs/expo-bridge-project-id-ignores-dynamic-config.md) is fixed here.
Resolving the app config is one of the container checks the new UI needs.

## Approach

**Each extension keeps its current job.** The workspace extension runs
everything in the container. The host extension provides `status`, `build`,
`install`, `launch`, `screenshot`, and the fixes on the Mac. All the new UI is
in the workspace extension. It reaches the host only through the existing
`expoBridge.ui.dispatch` requests, and through host commands that already exist
(`expoBridge.fix`, `expoBridge.setToken`, `expoBridge.manageTrust`). It calls
those commands with no arguments, so each still asks for consent on the Mac
itself. The fix flow, the host's fix status bar item, and its toasts stay as
they are. The host sends each build log chunk to the workspace command
`expoBridge.workspace.buildLog`, since the container sees a Mac file grow only
when the host closes it. The protocol stays at version 2 with no new request or
response field.

```
 workspace extension (container)                    host extension (Mac)
┌──────────────────────────────────────────────┐   ┌─────────────────────────────────┐
│ status store ◀── every status response ──────┼───┤ status / build / install / ...  │
│   (socket from eas-host, or the panel)       │   │                                 │
│   easProjectId ← resolved in the container   │   │ expoBridge.fix (quick pick,     │
│ panel (activity bar) · status bar item ·     │   │   terminal, re-check)           │
│   Problems + quick fixes                     │   │ expoBridge.setToken /           │
│ Re-run status / Build ── dispatch ───────────┼──▶│   manageTrust                   │
│ Fix… / Set token / Trust ── no-arg command ──┼──▶│                                 │
│ build log → eas-host / terminal ◀── chunks ──┼───┤ expoBridge.workspace.buildLog   │
└──────────────────────────────────────────────┘   └─────────────────────────────────┘
```

- **One path for every request.** The socket handler and the panel send requests
  through one function. It dispatches the request, passes the build log chunks
  the Mac sends for the folder to `eas-host` or the panel, and passes every
  `status` result through the container's checks before anyone sees it. So
  `eas-host status` and the panel always show the same result.
- **The project ID is resolved in the container.** Evaluating `app.config.*`
  there runs the container's own code, so it crosses no trust boundary. The host
  still never evaluates project code outside a confirmed build.
- **The panel** is an `Expo Bridge` view container in the activity bar, which
  the user can move to the bottom panel or the secondary sidebar. It shows the
  last status per Expo folder. The first status request runs the first time the
  panel becomes visible in a window. After that, a request runs only on Re-run
  or when `eas-host status` goes through the window's socket.
- **The build profile is remembered** per workspace folder in the extension's
  `workspaceState`: per user, writing no files.
- **Problems** gets a diagnostic for every failing status check and every
  container config check, with a quick fix where one exists. Checks that have no
  file of their own are anchored to the folder's `eas.json`.

**Rejected: the host extension contributes the panel's views.** It moves UI to
the host and changes what each extension does.

**Rejected: diagnostics computed on the host.** The host's files rules allow it
to read only `eas.json` and `app.json`, and it would need to publish diagnostics
on files in the container. The container reads its own files directly.

**Assumptions:**

- When `available` is false, Problems shows one Information diagnostic naming
  the failing availability check (`macHost`, `hostPathExists`, or
  `workspaceMapped`). The skipped tool checks get none, since `status` reports
  them as failing only because they were skipped.
- Severity: Error for `xcode`, `cocoapods`, `fastlane`, `node`, `bun`, `easCli`,
  `easProjectId`, including a project ID that cannot be resolved, and a missing
  simulator profile. Warning for `workspaceTrusted`, `expoToken`, and a
  remembered profile that no longer exists. Information for `simulator`,
  `port8081Forwarded`, and availability.
- `jsonc-parser` is added as a workspace dependency. It finds the JSON ranges
  diagnostics point at and inserts the simulator profile.
- The panel's build covers `build` and a clean build only. `install`, `launch`,
  and `screenshot` stay `eas-host` actions.

## Implementation Steps

### Task 1: One request path in the workspace extension

**Files:** Create: `packages/workspace/src/requests.ts`,
`packages/workspace/test/requests.test.ts`; Modify:
`packages/workspace/src/extension.ts`, in `plume-works/vscode-expo-bridge`

- [x] `runRequest(request, onLog)` dispatches through `expoBridge.ui.dispatch`
  and passes `onLog` the build log while a `build` runs. The socket handler
  `handleRequest` uses it, and the CLI's behavior does not change.
  - **Evidence:** plume-works/vscode-expo-bridge `880dd2b`:
    `packages/workspace/src/requests.ts` `runRequest(request, execute, onLog)`,
    which takes the command runner as a parameter so it is testable without
    `vscode`; `handleRequest` emits its response. `requests.test.ts` "streams
    the build log written while a build runs" passes, and `bun test` passes
    336/336.
- [x] A dispatch rejected because `expoBridge.ui.dispatch` is not registered is
  reported as host-not-installed, distinct from other failures. A test covers
  both outcomes.
  - **Evidence:** `880dd2b` `RequestOutcome.hostMissing` from
    `isCommandNotFound`; `requests.test.ts` "reports a missing host command as
    host-not-installed" and "reports any other failure without
    host-not-installed" pass.

### Task 2: Resolve the project ID in the container

**Files:** Create: `packages/workspace/src/appconfig.ts`,
`packages/workspace/test/appconfig.test.ts`, in `plume-works/vscode-expo-bridge`

- [x] `resolveProjectId(folder, runner, fileExists)` runs the folder's own
  `node_modules/.bin/expo config --json --type public` with the folder as its
  working directory and reads `extra.eas.projectId`. It never runs `bunx`, which
  could fetch Expo from the registry.
  - **Evidence:** plume-works/vscode-expo-bridge `24a66ea`
    `packages/workspace/src/appconfig.ts` `resolveProjectId`;
    `appconfig.test.ts` "runs expo config --json --type public in the folder"
    passes.
- [x] Without a local `expo`, it reads `app.json` statically when no
  `app.config.js` or `app.config.ts` exists. Otherwise it reports the ID as
  unresolved, with a reason.
  - **Evidence:** `24a66ea`; the four "resolveProjectId without a local expo"
    tests in `appconfig.test.ts` pass, including "a dynamic config is unresolved
    and names the file". `.mjs` and `.cjs` configs count as dynamic too.
- [x] Results are cached per folder. A file system watcher on `app.json`,
  `app.config.*`, `eas.json`, and `package.json` clears the cache.
  - **Evidence:** `24a66ea` `ProjectIdCache`, and the `PROJECT_ID_INPUTS_GLOB`
    watcher in `packages/workspace/src/extension.ts` `activate`, which clears
    the containing folder's entry; `appconfig.test.ts` "resolves a folder once
    until it is cleared" passes.
- [x] Tests cover the bug's three reproduction cases, a fake runner standing in
  for `expo config`: the ID set only in `app.config.ts` and the ID added by
  `app.config.js` resolve as set, and the ID dropped by `app.config.js` resolves
  as not set.
  - **Evidence:** `24a66ea` `appconfig.test.ts`: "an ID set only in
    app.config.ts resolves as set", "an ID that app.config.js adds to app.json
    resolves as set", and "an ID that app.config.js drops from app.json resolves
    as not set" pass; `bun test` passes 347/347.

### Task 3: Status results pass through the container checks

**Files:** Create: `packages/workspace/src/statusstore.ts`,
`packages/workspace/test/statusstore.test.ts`; Modify:
`packages/workspace/src/requests.ts`, in `plume-works/vscode-expo-bridge`

- [x] Every successful `status` response from `runRequest` has its
  `checks.easProjectId` replaced by Task 2's result before it is returned. An
  unresolved ID gives `ok: false` with its reason as the detail, so
  `eas-host status` prints the container's answer.
  - **Evidence:** plume-works/vscode-expo-bridge `59e06bb`: `relayRequest` wraps
    `runRequest` and applies `projectIdCheck`, and the socket handler
    `handleRequest` relays through it. `requests.test.ts` "replaces the host's
    easProjectId with the container's resolution" and "maps each resolution to a
    check" pass.
- [x] The store keeps the last status result per folder, with its time, and the
  last host-not-installed or failure outcome. It fires a change event that the
  panel, the status bar item, and Problems subscribe to.
  - **Evidence:** `59e06bb` `packages/workspace/src/statusstore.ts`
    `StatusStore` with `onDidChange`, fed by `relayRequest`'s `onOutcome`, and
    `retain` run when the window's folders change. The four
    `statusstore.test.ts` tests pass, and `bun test` passes 354/354. Tasks 5, 7,
    and 8 subscribe to it.

### Task 4: Container checks on `eas.json`

**Files:** Create: `packages/workspace/src/easjson.ts`,
`packages/workspace/test/easjson.test.ts`; Modify:
`packages/protocol/src/index.ts`, `packages/host/src/eascli.ts`, in
`plume-works/vscode-expo-bridge`

- [x] `normalizeRange` moves from `packages/host/src/eascli.ts` into the
  protocol package. The host imports it from there, and its tests pass
  unchanged.
  - **Evidence:** plume-works/vscode-expo-bridge `49c1fd8`:
    `packages/protocol/src/index.ts` `normalizeRange`, which
    `packages/host/src/eascli.ts` imports and re-exports;
    `packages/host/test/eascli.test.ts` passes unchanged.
- [x] `easJsonChecks(folder, rememberedProfile)` reports two things: no build
  profile with `ios.simulator: true`, and a remembered profile that `eas.json`
  no longer defines. Each comes with its JSON range.
  - **Evidence:** `49c1fd8` `packages/workspace/src/easjson.ts`
    `easJsonChecks(readEasJson(folder), rememberedProfile)`. It follows
    `extends` chains, and the range is the `build` key, else the file's first
    character. `jsonc-parser` 3.3.1 was added here rather than in Task 8,
    because this task needs it for the ranges. The `easjson.test.ts` checks
    tests pass.
- [x] `buildProfiles(folder)` lists `eas.json`'s build profiles for the panel's
  profile picker.
  - **Evidence:** `49c1fd8` `buildProfiles(readEasJson(folder))`;
    `easjson.test.ts` "lists the build profiles in file order" passes, and
    `bun test` passes 363/363.

### Task 5: The panel

**Files:** Create: `packages/workspace/src/panel.ts`,
`packages/workspace/media/expo-bridge.svg`; Modify:
`packages/workspace/package.json`, `packages/workspace/src/extension.ts`, in
`plume-works/vscode-expo-bridge`

- [x] `package.json` contributes an activity-bar view container `expoBridge`
  with a placeholder icon, and a tree view `expoBridge.panel`.

  - **Evidence:** plume-works/vscode-expo-bridge `a722022`
    `packages/workspace/package.json` `contributes.viewsContainers` and `views`,
    with `media/expo-bridge.svg`, which
    `bun run --filter vscode-expo-bridge-workspace package` includes in the
    VSIX.

- [x] The tree shows these sections for each workspace folder with an
  `eas.json`, and leaves out the folder level when there is one:

  - Connection: availability, the folder's Mac path, and protocol versions;
  - Mac tools: `xcode`, `cocoapods`, `fastlane`, `node`, and `bun`;
  - Project: `easCli`, `easProjectId`, and Task 4's checks;
  - Trust & token: `workspaceTrusted` and `expoToken`;
  - Simulator: `simulator` and `port8081Forwarded`.

  Each item shows its check's detail.

  - **Evidence:** `a722022`: `packages/workspace/src/panelmodel.ts` `panelTree`,
    with the check metadata in `checks.ts`, and the vscode glue in `panel.ts`
    and `ui.ts`. The `panelmodel.test.ts` tests "shows the sections directly for
    one folder", "shows each check's detail, and marks a failing Mac tool
    fixable", "adds the container's eas.json problems to Project", and "an
    unavailable folder beside an available one shows only its connection" pass,
    and still pass at `f269245`, whose CI run `40619096690` passes.

- [x] Before any status, after host-not-installed, and when unavailable, the
  view shows welcome content saying what that state means. Host-not-installed
  opens the Extensions view on `plume-works.vscode-expo-bridge-host`, for its
  **Install Locally**. Unavailable names the failing availability check and that
  EAS cloud builds still work.

  - **Evidence:** `a722022` `contributes.viewsWelcome`, one entry per
    `expoBridge.panelState` value, which `panelState` sets: `no-project`,
    `not-checked`, `failed`, `host-missing` (a `workbench.extensions.search`
    link), and one `unavailable-<check>` per availability check.
    `panelmodel.test.ts` "names each state the welcome content covers" and "is
    empty unless ready, so the welcome content shows" pass.

- [x] The first time the view becomes visible in a window, it sends one `status`
  request for each Expo folder, carrying `containerBunVersion` as `eas-host`
  does. Nothing in `activate()` awaits revealing or focusing a view, since
  awaiting that during activation deadlocks the extension.

  - **Evidence:** `a722022` `packages/workspace/src/ui.ts`: `firstLook` runs
    from `onDidChangeVisibility` and a zero-delay timer, and `requestStatus`
    sends `containerBunVersion` from `cli-args.ts`. `activate` awaits nothing.
    The jsonc-parser import uses its ESM build, because the UMD build failed
    activation of the bundled extension. `bun test` passes 373/373.

### Task 6: Panel actions

**Files:** Modify: `packages/workspace/src/panel.ts`,
`packages/workspace/package.json`, in `plume-works/vscode-expo-bridge`

- [x] **Re-run status** in the view title sends one `status` request for each
  Expo folder.
  - **Evidence:** plume-works/vscode-expo-bridge `9c54e69`:
    `expoBridge.panel.refresh` in `view/title` runs `requestStatus` in
    `packages/workspace/src/ui.ts`, through the same `relayRequest` as the
    socket.
- [x] **Build** builds the folder's remembered profile, asking from
  `buildProfiles` the first time and storing the answer in `workspaceState`
  under the folder's path. **Change build profile** asks again. **Clean build**
  sends the same request with `clean: true`. The log streams to
  `Expo Bridge Build`, and a notification names the artifact and the
  `mode`/`reason`.
  - **Evidence:** `9c54e69`: `build` and `pickProfile` in `ui.ts`, with the
    `workspaceState` key `profileKey(folder)` and the `buildMessage` text in
    `actions.ts`. The `actions.test.ts` `buildMessage` tests pass. Task 12
    checks on the Mac that a second build does not ask for the profile.
- [x] **Fix…** on a failing Mac tool item runs `expoBridge.fix`. **Set
  EXPO_TOKEN** runs `expoBridge.setToken`, and **Manage trust** runs
  `expoBridge.manageTrust`. Each is called with no arguments.
  - **Evidence:** `9c54e69`: `expoBridge.panel.fix`, `.setToken`, and
    `.manageTrust` are inline on the `expoBridge.check.fixable`, `.expoToken`,
    and `.workspaceTrusted` items. Each runs `host(HOST_COMMANDS.*)`, which
    drops the tree item argument. `actions.test.ts` "names the host's existing
    consent-bearing commands" passes, and `bun test` passes 378/378.

### Task 7: The status bar item

**Files:** Create: `packages/workspace/src/statusbar.ts`; Modify:
`packages/workspace/src/extension.ts`, in `plume-works/vscode-expo-bridge`

- [x] A status bar item is shown while the extension is active. It reads
  `Expo Bridge: OK` when every folder's last status is available and has no
  Error or Warning diagnostic. It reads `Expo Bridge: N issues` with N the Error
  and Warning count, `Expo Bridge: unavailable`,
  `Expo Bridge: Mac half not installed`, or `Expo Bridge: not checked`. Clicking
  it opens the panel.
  - **Evidence:** plume-works/vscode-expo-bridge `bd0bd26`:
    `packages/workspace/src/statusbar.ts` `statusBarState`, which counts
    `issues.ts` `folderIssues` (the list Task 8's diagnostics use). The item is
    created in `ui.ts` with the command `workbench.view.extension.expoBridge`.
    It is hidden in a window with no Expo folder, and a failed status reads "not
    checked". The `statusbar.test.ts` tests pass, and `bun test` passes 385/385.

### Task 8: Diagnostics in Problems

**Files:** Create: `packages/workspace/src/diagnostics.ts`,
`packages/workspace/test/diagnostics.test.ts`; Modify:
`packages/workspace/package.json` (`jsonc-parser`), in
`plume-works/vscode-expo-bridge`

- [x] `diagnosticsFor(folder, status, containerChecks)` returns one diagnostic
  per failing check, with the check's detail as the message and its key as the
  code, at the Approach's severities. Anchors:
  - `easCli` → `eas.json` `cli.version`;
  - `easProjectId` → the first line of `app.config.*` when the folder has one,
    since it decides the value; else `app.json` `expo.extra`, else `expo`;
  - Task 4's checks → their own ranges;
  - every other check → the first line of `eas.json`.
  - **Evidence:** plume-works/vscode-expo-bridge `60353f3`:
    `packages/workspace/src/diagnostics.ts`
    `diagnosticsFor(view, readFolderFiles(folder))`, where the view carries the
    folder, its status, and the container's checks. When a dynamic config
    exists, `easProjectId` is anchored to its first line ahead of `app.json`,
    since that config decides the value. The `diagnostics.test.ts` anchor and
    severity tests pass. `jsonc-parser` was already added in Task 4.
- [x] When `available` is false, only the availability diagnostic is published.
  The diagnostics are republished on every store change and every watched file
  change, and cleared for a folder removed from the window.
  - **Evidence:** `60353f3`: `publishDiagnostics` in `ui.ts` clears the
    collection and republishes from the current Expo folders on every `refresh`.
    `refresh` runs on store changes, folder changes, and the config watcher.
    `diagnostics.test.ts` "an unavailable status publishes only its availability
    diagnostic" passes, and `bun test` passes 392/392.

### Task 9: Quick fixes

**Files:** Create: `packages/workspace/src/quickfix.ts`,
`packages/workspace/test/quickfix.test.ts`, in `plume-works/vscode-expo-bridge`

- [x] A `CodeActionProvider` for the bridge's diagnostics offers:
  - `xcode`, `cocoapods`, `fastlane`, `node`, `bun` → **Fix on the Mac…**, which
    runs `expoBridge.fix` with no arguments;
  - `expoToken` → **Set EXPO_TOKEN on the Mac…**, which runs
    `expoBridge.setToken`;
  - `workspaceTrusted` → **Manage trust on the Mac…**, which runs
    `expoBridge.manageTrust`;
  - `easProjectId`, for a folder without `app.config.*` → **Link the EAS
    project**, which opens a container terminal in the folder running
    `bunx eas-cli@<spec> init`, with `<spec>` from `normalizeRange` on
    `cli.version`, else `latest`. For a dynamic config there is no quick fix:
    the message says to set `extra.eas.projectId` in the config it exports;
  - `port8081Forwarded` → **Start Metro in the container**, which opens a
    container terminal running
    `bunx expo start --dev-client --localhost --port 8081`;
  - no simulator profile → **Add a simulator build profile**, a `WorkspaceEdit`
    through `jsonc-parser` that inserts the profile below under `build`. When
    `build.development` already exists, the profile is named
    `development-simulator`, with the same body;
  - a remembered profile that no longer exists → **Pick a build profile…**, Task
    6's **Change build profile**.
  - **Evidence:** plume-works/vscode-expo-bridge `0c18bc7`:
    `packages/workspace/src/quickfix.ts` `quickFixesFor` and
    `simulatorProfileEdits`. `codeactions.ts` registers the `CodeActionProvider`
    and `expoBridge.quickfix.runInTerminal`, which opens the container terminal.
    The `quickfix.test.ts` tests pass, including "inserts the development
    simulator profile under build" with the plan's body and
    `"ios": { "simulator": true }` on one line.
- [x] `easCli`, `simulator`, and availability get no quick fix.
  - **Evidence:** `0c18bc7`; `quickfix.test.ts` "easCli, simulator, and
    availability get none" passes, and `bun test` passes 401/401.

The inserted profile:

``` json
"development": {
  "developmentClient": true,
  "distribution": "internal",
  "ios": { "simulator": true }
}
```

### Task 10: Documentation and version

**Files:** Modify: `docs/protocol.md`, `packages/workspace/README.md`, the three
extensions' `package.json` versions (through `bun run bump`), in
`plume-works/vscode-expo-bridge`

- [x] `docs/protocol.md` `### status` says that the workspace extension replaces
  `easProjectId` with the container's resolution of the app config in every
  result it relays. `## Fixes are not protocol actions` says that the panel and
  the quick fixes start a fix only through `expoBridge.fix` with no arguments,
  and that the Mac picker still decides.
  - **Evidence:** plume-works/vscode-expo-bridge `cce47ba` `docs/protocol.md`: a
    new paragraph under `### status`, and a new last paragraph of
    `## Fixes are not protocol actions`. `bun run lint` passes.
- [x] The workspace README describes the panel, the status bar item, Problems,
  and its quick fixes. The pack and both extensions carry the next minor
  version.
  - **Evidence:** `cce47ba`: `packages/workspace/README.md`
    `## Panel, status bar, and Problems`. `530b160`: `bun run bump 0.4.0` sets
    the pack, host, and workspace to 0.4.0. That is the next even minor, so the
    release workflow's `channelOf` publishes it as a release, not a pre-release.

### Task 11: Sibling repository CI passes

**Files:** none

- [x] The sibling repository's CI passes on the commit that completes Tasks
  1–10.
  - **Evidence:** `build` passes in CI run `40422198156` on
    plume-works/vscode-expo-bridge#25 at `530b160`: lint, typecheck, `bun test`,
    and three VSIX packaged.

### Task 12: Mac round trip from the packaged VSIX files

**Files:** none. On an Apple silicon Mac, with the packaged host and workspace
VSIX files from the Task 11 commit sideloaded and an Expo consumer opened in a
Dev Containers window.

- [x] Opening the panel runs one status, the status bar item reads
  `Expo Bridge: OK`, and a build of the remembered profile streams its log to
  `Expo Bridge Build`. A second build does not ask for the profile.
  - **Evidence:** Mac run of 0.4.0 at `530b160`: one status, `Expo Bridge: OK`,
    and no profile prompt on the second build. Mac re-run at `0c15a5c`: a clean
    build streamed eas-cli output to the `Expo Bridge Build` channel while it
    ran.
- [x] With CocoaPods uninstalled, Re-run shows the `cocoapods` diagnostic in
  Problems, and its quick fix opens the host's existing fix picker.
  - **Evidence:** Mac run of 0.4.0 at `530b160`, VS Code 1.143.1: with
    `brew unlink cocoapods`, Problems showed `CocoaPods not found` at `eas.json`
    Ln 1, and **Fix on the Mac…** opened the host's picker, running nothing
    until a fix was picked.
- [x] A project whose ID is set only in `app.config.ts` shows no `easProjectId`
  diagnostic, and `eas-host status` reports the check as passing.
  - **Evidence:** same Mac run: with the ID only in `app.config.ts`, no
    `easProjectId` diagnostic, and `eas-host status` reported
    `"easProjectId":{"ok":true}`. With no ID anywhere it reported
    `extra.eas.projectId not set in the app config`.
- [x] Removing the simulator profile shows its diagnostic, and the quick fix
  inserts the profile.
  - **Evidence:** same Mac run: the diagnostic sat on the `"build"` key, **Add a
    simulator build profile** inserted `development`, and the diagnostic
    cleared.
- [x] With the host extension uninstalled from the Mac, the panel shows the
  host-not-installed welcome and the status bar item reads
  `Expo Bridge: Mac half not installed`.
  - **Evidence:** same Mac run: the welcome with **Show the Mac half** appeared,
    and the status bar read `Expo Bridge: Mac half not installed`.

### Task 12a: Stream the build log from the host

The container cannot tail the Mac's build log: it sees the file grow only when
the host closes it ([the container sees the Expo bridge's build log only after
the build ends](../bugs/expo-bridge-build-log-invisible-until-close.md)).

**Files:** Create: `packages/host/src/buildlog.ts`. Modify:
`packages/protocol/src/index.ts`, `packages/host/src/build.ts`,
`packages/host/src/extension.ts`, `packages/workspace/src/requests.ts`,
`packages/workspace/src/extension.ts`, `docs/protocol.md`. In
`plume-works/vscode-expo-bridge`.

- [x] The host sends each build log chunk to the workspace command
  `expoBridge.workspace.buildLog`, one call at a time and all before the
  response. The workspace passes the folder's chunks, as lines, to `eas-host`
  and the panel, and no longer tails the file.
  - **Evidence:** `dd7cbf2`; `bun test` 407 pass, including the new
    `buildlog.test.ts`, the `BuildLogs` tests, and the `build` test that passes
    `onLog` every chunk it writes. `bun run typecheck` and `bun run lint` pass.
- [x] Both build log bugs record the fix in `## Fix` and `## Key references`.
  - **Evidence:** both bugs' `## Fix` describe the command stream and their
    `## Key references` are verified at `0c15a5c`. Ship sets them to
    `stage: done` through the plan's `release` list.
- [x] The panel shows the build log in an `Expo Bridge Build` terminal that
  renders eas-cli's colours, reopened when the user has closed it.
  - **Evidence:** `f269245`: `PendingWrites` in `buildterminal.ts` and its test,
    the pseudoterminal in `ui.ts`; `bun test` 409 pass. On the Mac, a clean
    build streamed eas-cli's coloured `[Codegen]` lines into the
    `Expo Bridge Build` terminal.

### Task 13: Record the panel in this repository's project memory

**Files:** Modify: `docs/knowledge/data/features/vscode-expo-bridge.md`,
`docs/knowledge/data/architecture/vscode-expo-bridge.md`,
`docs/knowledge/data/bugs/expo-bridge-project-id-ignores-dynamic-config.md`

- [x] The feature's `## Behaviour` describes the panel, the status bar item, and
  Problems with quick fixes.
  - **Evidence:** `data/features/vscode-expo-bridge.md` `## Behaviour` "A panel,
    a status bar item, and Problems", checked against `panelmodel.ts`,
    `statusbar.ts`, and `quickfix.ts` at `f269245`.
- [x] The architecture document places the UI in the workspace extension, states
  the no-argument host command rule and the activation constraint, and records
  both rejected alternatives. The first is recorded as a capability: a `ui`
  extension's views can live in a view container a `workspace` extension
  declares, hidden elsewhere by a `when` clause on a context key the container
  sets.
  - **Evidence:** `data/architecture/vscode-expo-bridge.md`
    `### The workspace UI` (one request path, no-argument host commands,
    activation awaits no view), and two `### Rejected alternatives` entries, the
    first naming the `when`-clause capability; checked against `ui.ts` and
    `package.json` at `f269245`.
- [x] The bug's `## Fix` and `## Key references` describe the container's
  resolution of the project ID.
  - **Evidence:** `data/bugs/expo-bridge-project-id-ignores-dynamic-config.md`
    `## Fix` describes `resolveProjectId` and `relayRequest`, and its
    `## Key references` are verified at `f269245`.
- [x] `iwe normalize` and `iwe schema validate` pass.
  - **Evidence:** both pass at the repository root on the commit that ticks this
    box, and its `iwe-normalize` and `iwe-schema-validate` pre-commit hooks
    pass.

## Spec changes

None in `data/spec/`. This repository's spec covers only the template wiring,
which this plan leaves unchanged. The behavior lives in
`plume-works/vscode-expo-bridge` `docs/protocol.md` (Task 10). Its intended
post-change behavior, which Task 12 verifies:

``` markdown
## ADDED Requirements

### Requirement: the workspace extension relays the container's project ID check

The workspace extension SHALL replace `checks.easProjectId` in every `status`
result it relays, to `eas-host` or to its own UI, with the project ID resolved
from the folder's app config in the container. It SHALL resolve the config only
with the folder's locally installed `expo`, and SHALL report the check as
failing with a reason when the config cannot be resolved. The host SHALL NOT
evaluate project code to answer `status`.

#### Scenario: a dynamic config sets the project ID

- **WHEN** `app.config.ts` sets `extra.eas.projectId` and `app.json` does not
- **THEN** `eas-host status` reports `easProjectId` as passing

#### Scenario: a dynamic config drops the project ID

- **WHEN** `app.json` sets `extra.eas.projectId` and `app.config.js` removes it
- **THEN** `eas-host status` reports `easProjectId` as failing

#### Scenario: the config cannot be resolved

- **WHEN** a folder has `app.config.js` and no local `expo`
- **THEN** `easProjectId` fails with a detail saying the config could not be
  resolved

### Requirement: the workspace UI reaches the Mac only through existing consent

The workspace extension's panel, status bar item, and quick fixes SHALL reach
the host only through `status` and `build` requests and the host commands
`expoBridge.fix`, `expoBridge.setToken`, and `expoBridge.manageTrust`, each
called with no arguments. A fix SHALL start only from a pick in the host's own
picker, and a build only after the host's trust and build confirmation.

#### Scenario: a quick fix for a Mac tool

- **WHEN** the user applies the quick fix on a `cocoapods` diagnostic
- **THEN** the host's fix picker opens, and nothing runs until a fix is picked
  there

#### Scenario: a build from the panel

- **WHEN** the user runs Build in the panel
- **THEN** the host asks for its build confirmation as it does for
  `eas-host build`

### Requirement: Problems shows the bridge's failing checks

While a folder's last `status` is available, the workspace extension SHALL
publish one diagnostic for each failing status check and each failing container
check on `eas.json`. When `status` is unavailable it SHALL publish only one
diagnostic, naming the failing availability check.

#### Scenario: a missing tool

- **WHEN** `status` reports `cocoapods` failing
- **THEN** Problems lists it on the folder's `eas.json` with the check's detail

#### Scenario: a non-Mac host

- **WHEN** `status` reports `macHost` failing
- **THEN** Problems lists one Information diagnostic and none for the skipped
  tool checks
```

## Depends on

- [Build iOS on the Mac host through a VS Code
  bridge](20261015-vscode-expo-bridge.md): the extensions this plan changes, and
  the release sequence it defines.
- [Expo bridge acts on the agent's window and workspace
  folder](20261023-expo-bridge-workspace-folders.md): the per-folder requests
  the panel sends.

## Verification

- In `plume-works/vscode-expo-bridge`, `bun test`, `bun run typecheck`, and
  `bun run lint` pass, and the sibling CI passes (Task 11).
- Task 12's Mac run behaves as described.
- `iwe normalize` and `iwe schema validate` pass.

## Verification results

Task 12, on an Apple silicon Mac with VS Code 1.143.1 and 0.4.0 at `530b160`:
four of five boxes pass. The first fails on one clause: the panel opens with one
status and `Expo Bridge: OK`, and a second build skips the profile prompt, but
the build streamed none of its log to the `Expo Bridge Build` channel, though
the log file on the Mac was complete. Streaming shares `runRequest` with
`eas-host build`, so the defect is not specific to the panel. Task 12a replaces
the file tail. At `0c15a5c` the Mac re-run streamed the build log while the
build ran, which passes the first box. The stream carried eas-cli's terminal
escape sequences, which an output channel shows as text, so the panel's build
log moves to a terminal.

## Out of scope

- Reworking the fix flow, the host's fix status bar item and toasts, and
  refreshing the panel when a fix ends: a follow-up.
- Icons beyond a placeholder: [Give the Expo bridge extensions
  icons](../backlog/expo-bridge-icons.md).
- `install`, `launch`, and `screenshot` from the panel.
- Refreshing status on a timer or on events other than first visibility, Re-run,
  and `eas-host status`.
- Protocol fields or a protocol version change.
- Publishing a release from the sibling repository.

## Key references

Verified anchor points (line numbers as of 2026-10-26):

In `plume-works/vscode-expo-bridge` at `b10949f`:

- `packages/workspace/src/extension.ts:18` — `DISPATCH_COMMAND`
- `packages/workspace/src/extension.ts:33` — `tailLog`
- `packages/workspace/src/extension.ts:62` — `newestBuildLog`
- `packages/workspace/src/extension.ts:79` — `handleRequest`
- `packages/workspace/src/extension.ts:117` — `activate`
- `packages/workspace/src/cli-args.ts:10` — `containerBunVersion`
- `packages/workspace/src/artifacts.ts:62` — `resolveRequest`
- `packages/workspace/bin/eas-host.ts:94` — `statusExit`
- `packages/workspace/package.json:22` — `activationEvents`
- `packages/protocol/src/index.ts:87` — `StatusResult`
- `packages/host/src/extension.ts:303` — `expoBridge.setToken`
- `packages/host/src/extension.ts:327` — `expoBridge.manageTrust`
- `packages/host/src/extension.ts:364` — `expoBridge.fix`
- `packages/host/src/eascli.ts:11` — `normalizeRange`
- `packages/host/src/status.ts:128` — `easCliCheck`
- `packages/host/src/status.ts:140` — `readProjectId`
- `docs/protocol.md:138` — `### status`
- `docs/protocol.md:347` — `## Fixes are not protocol actions`
