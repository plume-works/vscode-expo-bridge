// The fixed Expo-only protocol between the container-side `eas-host` command and
// the Mac-side host extension. The host extension never runs a command string from
// the container; it accepts exactly the actions named here. The prose contract and
// threat model live in docs/protocol.md.

export const PROTOCOL_VERSION = 2 as const;

/**
 * Each window's workspace extension serves `<id>.sock` here, next to `<id>.json`, its
 * registry entry; several windows can share one container.
 */
export const SOCKET_DIR = "/tmp/vscode-expo-bridge";

/** The `<id>.json` file a workspace extension writes next to its socket. */
export interface RegistryEntry {
  /** The extension host's process id; an entry whose process is gone is stale. */
  pid: number;
  /** Epoch ms of the activation, which breaks a tie between equally long folders. */
  activatedAt: number;
  /** The container paths of the window's workspace folders. */
  folders: string[];
}

/** A registry entry read from disk, or null when it does not have the entry's shape. */
export function parseRegistryEntry(value: unknown): RegistryEntry | null {
  const e = value as Partial<RegistryEntry> | null;
  if (typeof e !== "object" || e === null) return null;
  if (!Number.isInteger(e.pid) || (e.pid as number) <= 0) return null;
  if (typeof e.activatedAt !== "number" || !Number.isFinite(e.activatedAt)) return null;
  if (!Array.isArray(e.folders) || !e.folders.every((f) => typeof f === "string")) return null;
  return { pid: e.pid as number, activatedAt: e.activatedAt, folders: e.folders };
}

/** Every write the host extension makes under the workspace lands here, and nowhere else. */
export const WRITE_DIR_REL = ".tmp/expo-bridge";

/** The workspace-side command the host calls with each build log chunk while a build runs. */
export const BUILD_LOG_COMMAND = "expoBridge.workspace.buildLog";

export interface BuildLogChunk {
  /** The build request's container folder, which names the build the chunk belongs to. */
  folder: string;
  chunk: string;
}

export type Action = "status" | "build" | "install" | "launch" | "screenshot";

export const ACTIONS: readonly Action[] = ["status", "build", "install", "launch", "screenshot"];

/** Every request names the workspace folder it acts on, by its container path. */
interface FolderRequest {
  folder: string;
}

export interface StatusRequest extends FolderRequest {
  action: "status";
  /** The container's own `bun --version`, so the host can compare it to the Mac's bun. */
  containerBunVersion?: string;
}

export interface BuildRequest extends FolderRequest {
  action: "build";
  /** A profile name that must exist in the folder's `eas.json`. */
  profile: string;
  /** Build in full instead of reusing a matching earlier artifact; a host without reuse ignores it. */
  clean?: boolean;
}

export interface InstallRequest extends FolderRequest {
  action: "install";
  /** A folder-relative path that must resolve under `.tmp/expo-bridge/`. */
  artifactRel: string;
}

export interface LaunchRequest extends FolderRequest {
  action: "launch";
}

export interface ScreenshotRequest extends FolderRequest {
  action: "screenshot";
}

export type Request =
  | StatusRequest
  | BuildRequest
  | InstallRequest
  | LaunchRequest
  | ScreenshotRequest;

export interface StatusCheck {
  ok: boolean;
  /** Present when `ok` is false: a short reason, never any file contents. */
  detail?: string;
}

export interface StatusResult {
  protocolVersion: number;
  /** False on a non-Mac host, without the host path locally, or when the folder does not map. */
  available: boolean;
  /** The Mac path of the request's folder, which the checks inspected; empty when unmapped. */
  folderHostPath: string;
  checks: {
    macHost: StatusCheck;
    hostPathExists: StatusCheck;
    workspaceMapped: StatusCheck;
    workspaceTrusted: StatusCheck;
    xcode: StatusCheck;
    cocoapods: StatusCheck;
    fastlane: StatusCheck;
    node: StatusCheck;
    easCli: StatusCheck;
    bun: StatusCheck;
    expoToken: StatusCheck;
    easProjectId: StatusCheck;
    simulator: StatusCheck;
    port8081Forwarded: StatusCheck;
  };
}

export interface BuildResult {
  /** Folder-relative path of the artifact copied under `.tmp/expo-bridge/`. */
  artifactRel: string;
  /** Folder-relative path of the build log, tailed by `eas-host` while running. */
  logRel: string;
  exitCode: number;
  /** `reused` returned a stored artifact without running eas-cli; absent from a host without reuse. */
  mode?: BuildMode;
  /** Why a `built` build did not reuse an earlier artifact. */
  reason?: BuildReason;
  /** Epoch ms when a `reused` artifact was built. */
  reusedBuiltAt?: number;
}

export type BuildMode = "built" | "reused";

export type BuildReason = "clean-requested" | "no-fingerprint" | "no-match";

export interface InstallResult {
  bundleIdentifier: string;
}

export interface LaunchResult {
  bundleIdentifier: string;
}

export interface ScreenshotResult {
  /** Folder-relative path of the PNG written under `.tmp/expo-bridge/`. */
  screenshotRel: string;
}

export type Result = StatusResult | BuildResult | InstallResult | LaunchResult | ScreenshotResult;

export type ErrorCode =
  | "untrusted" // the workspace is not trusted on the Mac (declined or dismissed)
  | "build-declined" // the per-build confirmation was declined
  | "unavailable" // non-Mac host, no host path, or the folder does not map under it
  | "bad-request" // malformed request, an unknown action, or no folder
  | "bad-argument" // an argument failed validation (profile, path)
  | "path-escape" // a path resolved outside its allowed root
  | "symlink-rejected" // a path component or target is a symlink
  | "not-found" // a referenced file or profile does not exist
  | "action-failed"; // the underlying tool exited non-zero

export interface ProtocolError {
  code: ErrorCode;
  /** Human-readable; never contains the contents of any file the host read. */
  message: string;
}

export type Response = { ok: true; result: Result } | { ok: false; error: ProtocolError };

export function isAction(value: unknown): value is Action {
  return typeof value === "string" && (ACTIONS as readonly string[]).includes(value);
}

const COMPARATOR_RE =
  /^(?:[<>]=?|=|~|\^)?(?:\d+|[xX*])(?:\.(?:\d+|[xX*])){0,2}(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

/**
 * A semver version or range with the spaces after its operators removed, so it reads as
 * one `bunx` spec; null for `file:`, git, URL, alias, and dist-tag specs.
 */
export function normalizeRange(spec: string): string | null {
  if (!spec.trim()) return null;
  const sets = spec.split("||").map((set) => {
    const tokens = set
      .trim()
      .replace(/([<>]=?|=|~|\^)\s+/g, "$1")
      .split(/\s+/);
    const comparators =
      tokens.length === 3 && tokens[1] === "-" ? [tokens[0]!, tokens[2]!] : tokens;
    return comparators.every((t) => COMPARATOR_RE.test(t)) ? tokens.join(" ") : null;
  });
  return sets.every((set) => set !== null) ? sets.join(" || ") : null;
}
