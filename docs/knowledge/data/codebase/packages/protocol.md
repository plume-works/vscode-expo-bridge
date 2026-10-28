---
type: codebase
description: The shared TypeScript contract between eas-host, the workspace extension, and the host extension — protocol version, actions, request and result shapes, error codes, and the socket registry.
source: packages/protocol
source_digest: sha256:b03b422df087d094039657991bb84287171be4625ff7905d50092f8ba4f8009c
verified:
  by: claude-code/opus-5.5
  at: 2026-10-28T19:20:43Z
stale_after: 2027-01-26
generated:
  by: claude-code/opus-5.5
  at: 2026-10-28T19:20:43Z
sources:
- id: code
  resource: packages/protocol
---

# Protocol package

`@plume-works/expo-bridge-protocol`, a private workspace package with no build
step of its own: both extensions import its `src/index.ts` directly and bundle
it. It is the typed form of
[`docs/protocol.md`](https://github.com/plume-works/vscode-expo-bridge/blob/main/docs/protocol.md),
which holds the prose contract and the security model.

## Public surface

- `PROTOCOL_VERSION` — the version every `status` result reports and `eas-host`
  compares against its own.
- `SOCKET_DIR`, `RegistryEntry`, `parseRegistryEntry` — where each window's
  socket and `<id>.json` entry live, and the entry's validated shape.
- `WRITE_DIR_REL` — `.tmp/expo-bridge`, the only workspace directory the host
  writes into.
- `BUILD_LOG_COMMAND`, `BuildLogChunk` — the workspace-side command the host
  streams build output to.
- `Action`, `ACTIONS`, `isAction` — the fixed set `status`, `build`, `install`,
  `launch`, `screenshot`.
- `Request` / `Result` / `Response` unions, `StatusResult` with its fourteen
  named checks, `BuildResult` with `mode` and `reason`, `ErrorCode`.
- `normalizeRange` — turns an `eas-cli` version range from `eas.json` into a
  single `bunx` spec, or null for non-semver specs.

## How it works

Pure types and constants plus two validators; nothing here touches VS Code, the
file system, or a socket. Every request carries `folder`, the container path of
the workspace folder it acts on.

## Invariants & gotchas

- An incompatible change to any shape here raises `PROTOCOL_VERSION` and updates
  `docs/protocol.md` in the same change.
- Optional fields (`clean`, `mode`, `reason`) are how a newer half stays
  compatible with an older one inside one protocol version: an older host
  ignores `clean` and omits `mode`.
- `ProtocolError.message` never carries the contents of a file the host read.

## Key references

Verified anchor points (line numbers as of 2026-10-28):

- `packages/protocol/src/index.ts:6` — `PROTOCOL_VERSION`
- `packages/protocol/src/index.ts:12` — `SOCKET_DIR`
- `packages/protocol/src/index.ts:25` — `parseRegistryEntry`
- `packages/protocol/src/index.ts:35` — `WRITE_DIR_REL`
- `packages/protocol/src/index.ts:38` — `BUILD_LOG_COMMAND`
- `packages/protocol/src/index.ts:48` — `ACTIONS`
- `packages/protocol/src/index.ts:96` — `StatusResult`
- `packages/protocol/src/index.ts:120` — `BuildResult`
- `packages/protocol/src/index.ts:153` — `ErrorCode`
- `packages/protocol/src/index.ts:183` — `normalizeRange`
